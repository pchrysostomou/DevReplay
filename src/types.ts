// ─────────────────────────────────────────────────────────────────────────────
// src/types.ts — Shared TypeScript interfaces for DevReplay
// ─────────────────────────────────────────────────────────────────────────────

/** A single file that was changed in the PR */
export interface ChangedFile {
  filename: string
  patch: string       // the unified diff — lines prefixed with +, -, or space
  additions: number
  deletions: number
  status: 'added' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  language: string    // 'typescript' | 'javascript' | 'python' | etc.
}

/** Structured context about a PR */
export interface PRContext {
  owner: string
  repo: string
  pullNumber: number
  commitSha: string  // the HEAD commit of the PR branch
  title: string
  author: string
  installationId: number
}

/**
 * A single AI-generated review finding.
 * line = actual line number in the NEW version of the file (additions side).
 */
export interface ReviewComment {
  filename: string
  line: number
  severity: 'bug' | 'security' | 'performance' | 'style'
  title: string
  body: string
  suggestion?: string  // optional code fix — renders as GitHub "Apply suggestion" button
}

/**
 * Shared Octokit structural type.
 * @octokit/app v15 returns a base Octokit that exposes request() but not .rest.*.
 * Using this interface keeps both diffParser and commenter decoupled from Octokit internals.
 */
export interface OctokitLike {
  request: (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>
}

/** Supported code file extensions */
export const CODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.go', '.rs', '.java',
  '.rb', '.php', '.cs', '.cpp', '.c',
] as const
