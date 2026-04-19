import { CODE_EXTENSIONS, type ChangedFile, type OctokitLike } from '../types.js'

export type { OctokitLike }

// ─── Language detection ───────────────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.py':   'python',
  '.go':   'go',
  '.rs':   'rust',
  '.java': 'java',
  '.rb':   'ruby',
  '.php':  'php',
  '.cs':   'csharp',
  '.cpp':  'cpp',
  '.c':    'c',
}

export function detectLanguage(filename: string): string {
  const ext = Object.keys(LANGUAGE_MAP).find(e => filename.endsWith(e))
  return ext ? LANGUAGE_MAP[ext] : 'unknown'
}

export function isCodeFile(filename: string): boolean {
  return CODE_EXTENSIONS.some(ext => filename.endsWith(ext))
}

// ─── Diff line number parsing ─────────────────────────────────────────────────
//
// Parses unified diff patch to extract:
//   - added line numbers (for AI to reference)
//   - all diff line numbers (for comment validation — includes context lines)
//
// Unified diff format:
//   @@ -oldStart,oldCount +newStart,newCount @@
//   ' ' → context line (present in both old and new)
//   '+' → addition (only in new file)
//   '-' → removal (only in old file, does NOT advance new file line counter)

export interface DiffLine {
  newFileLineNumber: number
  isAddition: boolean   // true = '+' line, false = context line
  content: string
}

/**
 * Returns all lines that appear in the diff on the new-file side
 * (additions + context). GitHub only allows PR review comments on these lines.
 */
export function parseDiffLines(patch: string): DiffLine[] {
  const result: DiffLine[] = []
  let currentNewLine = 0

  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) currentNewLine = parseInt(match[1], 10) - 1
      continue
    }
    if (rawLine.startsWith('-') || rawLine.startsWith('\\')) continue

    currentNewLine++

    if (rawLine.startsWith('+')) {
      result.push({ newFileLineNumber: currentNewLine, isAddition: true, content: rawLine.slice(1) })
    } else {
      result.push({ newFileLineNumber: currentNewLine, isAddition: false, content: rawLine.slice(1) })
    }
  }

  return result
}

/**
 * Builds a map of filename → Set<validLineNumbers> for all files.
 * Used by the commenter to validate that AI-suggested line numbers exist in the diff.
 */
export function buildValidLinesMap(files: ChangedFile[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  for (const file of files) {
    const diffLines = parseDiffLines(file.patch)
    map.set(file.filename, new Set(diffLines.map(l => l.newFileLineNumber)))
  }
  return map
}

/**
 * Annotates a diff patch with [L{n}] markers on addition lines.
 * This is included in the AI prompt so the model knows exact line numbers to reference.
 */
export function annotateWithLineNumbers(patch: string): string {
  let currentNewLine = 0
  const lines: string[] = []

  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) currentNewLine = parseInt(match[1], 10) - 1
      lines.push(rawLine)
      continue
    }
    if (rawLine.startsWith('-') || rawLine.startsWith('\\')) {
      lines.push(rawLine)
      continue
    }
    currentNewLine++
    if (rawLine.startsWith('+')) {
      lines.push(`[L${currentNewLine}] ${rawLine}`)
    } else {
      lines.push(`      ${rawLine}`)
    }
  }

  return lines.join('\n')
}

// ─── PR diff fetching ─────────────────────────────────────────────────────────

/** Maximum number of files to process per PR review */
const MAX_FILES = 10

/** Maximum cumulative diff lines to send to AI */
const MAX_DIFF_LINES = 500

interface GHFile {
  filename: string
  patch?: string
  additions: number
  deletions: number
  status: string
}

export async function getPRChanges(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ChangedFile[]> {
  const response = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  })

  const files = response.data as GHFile[]

  const filtered = files
    .filter((f: GHFile) => f.status !== 'removed')
    .filter((f: GHFile) => isCodeFile(f.filename))
    .filter((f: GHFile) => f.additions > 0)
    .sort((a: GHFile, b: GHFile) => b.additions - a.additions)
    .slice(0, MAX_FILES)

  let lineCount = 0
  const result: ChangedFile[] = []

  for (const f of filtered) {
    const patch = f.patch ?? ''
    const patchLines = patch.split('\n').length
    if (lineCount + patchLines > MAX_DIFF_LINES) break
    lineCount += patchLines
    result.push({
      filename:  f.filename,
      patch,
      additions: f.additions,
      deletions: f.deletions,
      status:    f.status as ChangedFile['status'],
      language:  detectLanguage(f.filename),
    })
  }

  return result
}
