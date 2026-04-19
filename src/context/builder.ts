// ─────────────────────────────────────────────────────────────────────────────
// src/context/builder.ts — Codebase context builder
//
// What makes DevReplay different from a generic AI review:
// Before sending the diff to Groq, we read related files from the repo
// (files that are imported by the changed code) and include their content
// in the prompt. This lets the AI say "based on the pattern in lib/db.ts..."
// instead of reviewing the diff in isolation.
//
// Strategy:
//   1. Extract relative imports from PR diff additions
//   2. Resolve each import path (try .ts, .tsx, /index.ts extensions)
//   3. Fetch file content from GitHub at the PR's commit SHA
//   4. Include the first 60 lines of each file as context
//   5. Cap at 3 context files per changed file, 8 total
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path'
import type { ChangedFile, OctokitLike } from '../types.js'
import { logger } from '../utils/logger.js'

// ─── Import extraction ────────────────────────────────────────────────────────

/**
 * Extracts relative import paths from diff additions.
 * Only returns imports starting with '.' (relative paths within codebase).
 * Handles both:
 *   import X from './path'
 *   import { X } from '../path'
 *   const X = require('./path')
 */
export function extractImports(patch: string): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  // Match any + line that contains an import/require with a relative path
  const importRegex = /^\+[^+].*?(?:from|require\()\s*['"](\.[^'"]+)['"]/gm

  for (const match of patch.matchAll(importRegex)) {
    const importPath = match[1]
    // Skip node_modules aliases that start with ./ but are actually absolute
    if (!importPath.startsWith('.')) continue
    if (!seen.has(importPath)) {
      seen.add(importPath)
      results.push(importPath)
    }
  }

  return results
}

/**
 * Resolves a relative import path (e.g. '../database') to candidate absolute
 * repo paths to try. Returns multiple candidates because we don't know the extension.
 */
export function resolveImportPath(fromFile: string, importPath: string): string[] {
  const dir    = path.dirname(fromFile)
  const base   = path.join(dir, importPath).replace(/\\/g, '/')

  // If import already has a code extension, return it as-is
  if (/\.(ts|tsx|js|jsx|py|go|rs)$/.test(importPath)) {
    return [base]
  }

  // Try the most common TypeScript/JavaScript resolution order
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}.js`,
    `${base}/index.js`,
  ]
}

// ─── GitHub file fetcher ──────────────────────────────────────────────────────

/** Max lines to include from each context file */
const MAX_CONTEXT_LINES = 60

/** Max context files to fetch per changed file */
const MAX_IMPORTS_PER_FILE = 3

/** Absolute max context files across the whole PR */
const MAX_TOTAL_CONTEXT_FILES = 8

async function fetchFileContent(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  filePath: string,
  ref: string
): Promise<string | null> {
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: filePath,
      ref,
    })

    const data = response.data as { type?: string; content?: string; encoding?: string }

    if (data.type !== 'file' || !data.content || data.encoding !== 'base64') return null

    const content = Buffer.from(data.content, 'base64').toString('utf-8')
    // Keep only the first MAX_CONTEXT_LINES lines — we want context, not the whole file
    return content.split('\n').slice(0, MAX_CONTEXT_LINES).join('\n')
  } catch {
    // File not found or access error — silent continue
    return null
  }
}

// ─── Main context builder ─────────────────────────────────────────────────────

/**
 * Builds a codebase context string to prepend to the AI prompt.
 * Reads files imported by the changed code and includes their first 60 lines.
 */
export async function buildContext(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  changedFiles: ChangedFile[],
  ref: string,  // PR head commit SHA — fetches files at the PR's version
): Promise<string> {
  const contextParts: string[] = []
  const fetchedPaths = new Set<string>()
  let totalFetched = 0

  for (const file of changedFiles) {
    if (totalFetched >= MAX_TOTAL_CONTEXT_FILES) break

    const imports = extractImports(file.patch).slice(0, MAX_IMPORTS_PER_FILE)

    for (const importPath of imports) {
      if (totalFetched >= MAX_TOTAL_CONTEXT_FILES) break

      const candidates = resolveImportPath(file.filename, importPath)

      for (const candidate of candidates) {
        if (fetchedPaths.has(candidate)) break  // already have this file

        const content = await fetchFileContent(octokit, owner, repo, candidate, ref)

        if (content !== null) {
          fetchedPaths.add(candidate)
          totalFetched++

          contextParts.push(
            `// Context file: ${candidate}\n` +
            `// (Referenced by ${file.filename} — first ${MAX_CONTEXT_LINES} lines)\n` +
            content
          )

          logger.debug('Fetched context file', {
            from:    file.filename,
            import:  importPath,
            resolved: candidate,
            lines:   content.split('\n').length,
          })
          break  // found this import — stop trying other extensions
        }
      }
    }
  }

  if (contextParts.length === 0) return ''

  const header = `=== CODEBASE CONTEXT (${contextParts.length} related file${contextParts.length > 1 ? 's' : ''}) ===\n` +
    `These files are imported by the PR changes. Use them to give context-aware feedback.\n\n`

  logger.info('Context built', {
    filesRequested: changedFiles.length,
    contextFiles:   contextParts.length,
  })

  return header + contextParts.join('\n\n---\n\n')
}
