// ─────────────────────────────────────────────────────────────────────────────
// src/github/commenter.ts — Post AI review findings as GitHub PR inline comments
//
// Uses the GitHub Pull Request Reviews API to create a single review containing
// all inline comments at once — cleaner than posting comments one-by-one.
//
// If the AI finds no issues → posts an APPROVE review.
// If the AI finds issues  → posts a COMMENT review with inline findings.
//
// GitHub "suggestion" blocks render as an "Apply suggestion" button when using
// ``` suggestion code blocks — developers can accept fixes in one click.
// ─────────────────────────────────────────────────────────────────────────────

import type { OctokitLike, ReviewComment } from '../types.js'
import { logger } from '../utils/logger.js'

const SEVERITY_BADGE: Record<ReviewComment['severity'], string> = {
  bug:         '🐛 **Bug**',
  security:    '🔒 **Security**',
  performance: '⚡ **Performance**',
  style:       '✏️ **Style**',
}

function formatCommentBody(comment: ReviewComment): string {
  const badge = SEVERITY_BADGE[comment.severity]
  let body = `${badge} **${comment.title}**\n\n${comment.body}`

  if (comment.suggestion) {
    // GitHub renders ```suggestion blocks as an interactive "Apply suggestion" button
    body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``
  }

  body += '\n\n<sub>🤖 DevReplay AI Review</sub>'
  return body
}

export interface PostReviewOptions {
  octokit:     OctokitLike
  owner:       string
  repo:        string
  pullNumber:  number
  commitSha:   string
  comments:    ReviewComment[]
  /** Line numbers that actually exist in this PR's diff, per file */
  validLines:  Map<string, Set<number>>
}

export async function postReviewComments({
  octokit,
  owner,
  repo,
  pullNumber,
  commitSha,
  comments,
  validLines,
}: PostReviewOptions): Promise<void> {

  // ── No issues found → APPROVE ─────────────────────────────────────────────
  if (comments.length === 0) {
    logger.info('No issues found — posting approval', { pr: pullNumber })
    await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner,
      repo,
      pull_number: pullNumber,
      commit_id:   commitSha,
      event:       'APPROVE',
      body:        '✅ **DevReplay** reviewed this PR and found no issues. Looks good!',
    })
    return
  }

  // ── Validate line numbers against actual diff ──────────────────────────────
  // GitHub will reject the entire review if even one comment has an invalid line.
  // We filter out invalid ones and log them — they won't be silently lost.
  const validComments = comments.filter(c => {
    const fileLines = validLines.get(c.filename)
    if (!fileLines) {
      logger.warn('Comment references unknown file — skipping', {
        filename: c.filename,
        line:     c.line,
      })
      return false
    }
    if (!fileLines.has(c.line)) {
      logger.warn('Comment line not in diff — skipping', {
        filename: c.filename,
        line:     c.line,
        valid:    [...fileLines].slice(0, 10),
      })
      return false
    }
    return true
  })

  logger.info('Posting PR review with inline comments', {
    pr:            pullNumber,
    total:         comments.length,
    validInline:   validComments.length,
    skippedInvalid: comments.length - validComments.length,
  })

  const summaryLine = validComments.length > 0
    ? `**DevReplay** found **${validComments.length}** issue${validComments.length > 1 ? 's' : ''} in this PR.`
    : `**DevReplay** found ${comments.length} issue(s) but could not place inline comments — the referenced lines may not be part of this diff.`

  const severitySummary = comments.reduce<Record<string, number>>((acc, c) => {
    acc[c.severity] = (acc[c.severity] ?? 0) + 1
    return acc
  }, {})

  const summaryBody = [
    summaryLine,
    '',
    Object.entries(severitySummary)
      .map(([s, n]) => `- ${SEVERITY_BADGE[s as ReviewComment['severity']]}: ${n}`)
      .join('\n'),
  ].join('\n')

  await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner,
    repo,
    pull_number: pullNumber,
    commit_id:   commitSha,
    event:       'COMMENT',
    body:        summaryBody,
    comments:    validComments.map(c => ({
      path: c.filename,
      line: c.line,
      side: 'RIGHT',                // RIGHT = new-file side in split diff view
      body: formatCommentBody(c),
    })),
  })

  logger.info('PR review posted successfully', { pr: pullNumber })
}
