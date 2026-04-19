// ─────────────────────────────────────────────────────────────────────────────
// src/handlers/pullRequest.ts — Full W3 review pipeline
//
// Pipeline:
//   0. Rate limit check (10 reviews / hour / repo)
//   1. Fetch PR diff
//   2. Build valid-lines map (for comment placement)
//   3. Build codebase context (fetch imported files)
//   4. AI review via Groq (with context)
//   5. Post inline review comments
// ─────────────────────────────────────────────────────────────────────────────

import { getPRChanges, buildValidLinesMap, type OctokitLike } from '../github/diffParser.js'
import { postReviewComments } from '../github/commenter.js'
import { reviewCode } from '../ai/reviewer.js'
import { buildContext } from '../context/builder.js'
import { checkRateLimit } from '../utils/rateLimiter.js'
import { logger } from '../utils/logger.js'
import type { PRContext } from '../types.js'

export async function handlePullRequest(
  octokit: OctokitLike,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
): Promise<void> {
  const context: PRContext = {
    owner:          payload.repository.owner.login,
    repo:           payload.repository.name,
    pullNumber:     payload.pull_request.number,
    commitSha:      payload.pull_request.head.sha,
    title:          payload.pull_request.title,
    author:         payload.pull_request.user.login,
    installationId: payload.installation.id,
  }

  const repoFullName = `${context.owner}/${context.repo}`

  logger.info('Starting DevReplay review pipeline', {
    repo:      repoFullName,
    pr:        context.pullNumber,
    title:     context.title,
    author:    context.author,
    action:    payload.action,
    commitSha: context.commitSha.slice(0, 7),
  })

  // ── Step 0: Rate limit check ──────────────────────────────────────────────
  const rateLimit = checkRateLimit(repoFullName)

  if (!rateLimit.allowed) {
    logger.warn('Rate limit reached — skipping review', {
      repo:        repoFullName,
      pr:          context.pullNumber,
      resetInMins: rateLimit.resetInMins ?? 60,
    })

    // Post a friendly comment explaining the limit
    await postRateLimitComment(octokit, context, rateLimit.resetInMins ?? 60)
    return
  }

  // ── Step 1: Fetch PR diff ─────────────────────────────────────────────────
  logger.info('Step 1/4 — Fetching PR diff', { pr: context.pullNumber })

  const changedFiles = await getPRChanges(
    octokit,
    context.owner,
    context.repo,
    context.pullNumber
  )

  if (changedFiles.length === 0) {
    logger.info('No reviewable code changes found (markdown/config/binary only)', {
      pr: context.pullNumber,
    })
    return
  }

  logger.info('PR diff fetched', {
    pr:        context.pullNumber,
    files:     changedFiles.map(f => f.filename),
    totalAdds: changedFiles.reduce((s, f) => s + f.additions, 0),
  })

  // ── Step 2: Build valid lines map ─────────────────────────────────────────
  const validLines = buildValidLinesMap(changedFiles)

  // ── Step 3: Build codebase context ───────────────────────────────────────
  // Fetches files imported by the PR changes — lets the AI say
  // "based on the pattern in lib/db.ts..." instead of reviewing in isolation
  logger.info('Step 2/4 — Building codebase context', { pr: context.pullNumber })

  let codebaseContext = ''
  try {
    codebaseContext = await buildContext(
      octokit,
      context.owner,
      context.repo,
      changedFiles,
      context.commitSha,
    )
    if (codebaseContext) {
      logger.info('Codebase context ready', {
        pr:    context.pullNumber,
        chars: codebaseContext.length,
      })
    } else {
      logger.info('No context files found (new files or no relative imports)', {
        pr: context.pullNumber,
      })
    }
  } catch (err) {
    // Context is optional — continue without it if fetch fails
    logger.warn('Context build failed — proceeding without context', {
      error: (err as Error).message,
      pr:    context.pullNumber,
    })
  }

  // ── Step 4: AI review via Groq ────────────────────────────────────────────
  logger.info('Step 3/4 — Running AI review (Groq / Llama 3.3)', {
    pr:         context.pullNumber,
    hasContext: codebaseContext.length > 0,
  })

  let comments
  try {
    comments = await reviewCode(changedFiles, codebaseContext)
  } catch (err) {
    logger.error('Groq review failed — skipping comment posting', {
      error: (err as Error).message,
      pr:    context.pullNumber,
    })
    return
  }

  logger.info('AI review complete', {
    pr:       context.pullNumber,
    findings: comments.length,
    breakdown: comments.reduce<Record<string, number>>((acc, c) => {
      acc[c.severity] = (acc[c.severity] ?? 0) + 1
      return acc
    }, {}),
  })

  // ── Step 5: Post inline review comments ───────────────────────────────────
  logger.info('Step 4/4 — Posting inline review comments', { pr: context.pullNumber })

  await postReviewComments({
    octokit,
    owner:      context.owner,
    repo:       context.repo,
    pullNumber: context.pullNumber,
    commitSha:  context.commitSha,
    comments,
    validLines,
  })

  logger.info('✅ DevReplay review pipeline complete', {
    pr:         context.pullNumber,
    repo:       repoFullName,
    comments:   comments.length,
    hadContext: codebaseContext.length > 0,
  })
}

// ─── Rate limit notification ─────────────────────────────────────────────────

async function postRateLimitComment(
  octokit: OctokitLike,
  context: PRContext,
  resetInMins: number,
): Promise<void> {
  try {
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner:        context.owner,
      repo:         context.repo,
      issue_number: context.pullNumber,
      body: [
        '⏳ **DevReplay** — Rate limit reached',
        '',
        `This repository has used its review quota (10 reviews/hour). ` +
        `DevReplay will automatically resume in **~${resetInMins} minute${resetInMins !== 1 ? 's' : ''}**.`,
        '',
        '_To get an immediate review, push a new commit to this PR after the limit resets._',
      ].join('\n'),
    })
  } catch (err) {
    logger.error('Failed to post rate limit comment', { error: (err as Error).message })
  }
}
