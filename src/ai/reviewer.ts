// ─────────────────────────────────────────────────────────────────────────────
// src/ai/reviewer.ts — Groq AI code review engine (W3: context-aware)
//
// W3 upgrade: accepts a codebase context string (related files fetched by
// the context builder) and prepends it to the user message. This lets the
// model reference patterns from other files — e.g. "based on src/db.ts,
// you should use the existing pool instead of creating a new connection."
// ─────────────────────────────────────────────────────────────────────────────

import Groq from 'groq-sdk'
import type { ChangedFile, ReviewComment } from '../types.js'
import { annotateWithLineNumbers } from '../github/diffParser.js'
import { logger } from '../utils/logger.js'

/** Maximum findings to show per PR */
const MAX_COMMENTS = 5

const SEVERITY_PRIORITY: Record<ReviewComment['severity'], number> = {
  bug:         4,
  security:    3,
  performance: 2,
  style:       1,
}

/**
 * Sends annotated diff (+ optional codebase context) to Groq for review.
 * Returns validated, severity-sorted ReviewComment array.
 *
 * @param files        Changed files with patches
 * @param context      Optional codebase context from buildContext()
 */
export async function reviewCode(
  files: ChangedFile[],
  context = '',
): Promise<ReviewComment[]> {
  if (files.length === 0) return []

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

  // Build annotated diff — each + line labelled with [L{n}] so model knows the line number
  const diffText = files
    .map(f => {
      const annotated = annotateWithLineNumbers(f.patch)
      return `### File: ${f.filename} (${f.language})\n\`\`\`diff\n${annotated}\n\`\`\``
    })
    .join('\n\n')

  // Context-aware user message: context first, then the diff
  const userMessage = context
    ? `${context}\n\n${'='.repeat(60)}\n=== PR CHANGES TO REVIEW ===\n${'='.repeat(60)}\n\n${diffText}`
    : `Review these PR changes:\n\n${diffText}`

  logger.info('Sending diff to Groq for review', {
    files:       files.length,
    model:       'llama-3.3-70b-versatile',
    diffChars:   diffText.length,
    contextChars: context.length,
    hasContext:  context.length > 0,
  })

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `You are an expert code reviewer specializing in bugs, security vulnerabilities, and performance issues.

${context ? 'You have been provided CODEBASE CONTEXT — related files imported by the changed code. Use this context to give specific, cross-file feedback. Reference the context files when relevant (e.g. "Based on the pattern in src/db.ts...").' : ''}

Analyze the PR diff and return ONLY a valid JSON object with this exact shape:
{
  "comments": [
    {
      "filename": "exact/file/path.ts",
      "line": 42,
      "severity": "bug",
      "title": "Short issue title",
      "body": "Detailed explanation. Reference other files if relevant.",
      "suggestion": "optional corrected code"
    }
  ]
}

Rules:
- "line" MUST be a number from a [L{n}] annotation in the diff — do not invent line numbers
- "severity" must be one of: "bug", "security", "performance", "style"
- "body" should be 2-3 sentences. Reference context files by name when relevant: "Based on the pattern in src/db.ts..."
- "suggestion" is optional — only include if you have a concrete code fix
- Only flag real issues. Do NOT comment on style unless it causes bugs.
- Return {"comments": []} if no issues found.
- Return at most ${MAX_COMMENTS} comments, prioritizing bugs and security issues first.
- IMPORTANT: Return ONLY the JSON object, no markdown, no explanation outside JSON.`,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 2048,
  })

  const raw = response.choices[0].message.content ?? '{}'
  logger.debug('Groq raw response', { length: raw.length })

  let parsed: { comments?: unknown[] }
  try {
    parsed = JSON.parse(raw) as { comments?: unknown[] }
  } catch (err) {
    logger.error('Failed to parse Groq JSON response', { error: (err as Error).message })
    return []
  }

  const rawComments = Array.isArray(parsed.comments) ? parsed.comments : []

  const valid: ReviewComment[] = rawComments
    .filter((c): c is ReviewComment => {
      if (typeof c !== 'object' || c === null) return false
      const comment = c as Record<string, unknown>
      return (
        typeof comment.filename  === 'string' &&
        typeof comment.line      === 'number' &&
        typeof comment.severity  === 'string' &&
        typeof comment.title     === 'string' &&
        typeof comment.body      === 'string' &&
        ['bug', 'security', 'performance', 'style'].includes(comment.severity as string)
      )
    })
    .sort((a, b) => SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity])
    .slice(0, MAX_COMMENTS)

  logger.info('Groq review complete', {
    rawComments:   rawComments.length,
    validComments: valid.length,
  })

  return valid
}
