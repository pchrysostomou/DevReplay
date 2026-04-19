// ─────────────────────────────────────────────────────────────────────────────
// src/__tests__/diffParser.test.ts — Unit tests for diffParser module
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  isCodeFile,
  parseDiffLines,
  buildValidLinesMap,
  annotateWithLineNumbers,
} from '../github/diffParser.js'
import type { ChangedFile } from '../types.js'

// ─── detectLanguage ───────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  it('detects TypeScript from .ts extension', () => {
    expect(detectLanguage('src/utils/logger.ts')).toBe('typescript')
  })

  it('detects TSX from .tsx extension', () => {
    expect(detectLanguage('components/Button.tsx')).toBe('typescript')
  })

  it('detects JavaScript from .js extension', () => {
    expect(detectLanguage('config/webpack.js')).toBe('javascript')
  })

  it('detects Python from .py extension', () => {
    expect(detectLanguage('scripts/migrate.py')).toBe('python')
  })

  it('detects Go from .go extension', () => {
    expect(detectLanguage('cmd/main.go')).toBe('go')
  })

  it('returns "unknown" for unrecognised extension', () => {
    expect(detectLanguage('README.md')).toBe('unknown')
    expect(detectLanguage('Dockerfile')).toBe('unknown')
    expect(detectLanguage('.env')).toBe('unknown')
  })

  it('matches by extension even with nested paths', () => {
    expect(detectLanguage('a/b/c/d/e/file.rs')).toBe('rust')
  })
})

// ─── isCodeFile ───────────────────────────────────────────────────────────────

describe('isCodeFile', () => {
  it('returns true for TypeScript files', () => {
    expect(isCodeFile('src/server.ts')).toBe(true)
    expect(isCodeFile('app.tsx')).toBe(true)
  })

  it('returns true for other supported languages', () => {
    expect(isCodeFile('main.go')).toBe(true)
    expect(isCodeFile('main.py')).toBe(true)
    expect(isCodeFile('main.rs')).toBe(true)
    expect(isCodeFile('Main.java')).toBe(true)
  })

  it('returns false for non-code files', () => {
    expect(isCodeFile('README.md')).toBe(false)
    expect(isCodeFile('.env')).toBe(false)
    expect(isCodeFile('package.json')).toBe(false)
    expect(isCodeFile('image.png')).toBe(false)
  })
})

// ─── parseDiffLines ───────────────────────────────────────────────────────────

describe('parseDiffLines', () => {
  const samplePatch = `@@ -0,0 +1,5 @@
+const a = 1
+const b = 2
 const c = 3
+const d = 4
-const e = 5`

  it('extracts additions with correct line numbers', () => {
    const lines = parseDiffLines(samplePatch)
    const additions = lines.filter(l => l.isAddition)

    expect(additions).toHaveLength(3)
    expect(additions[0]).toMatchObject({ newFileLineNumber: 1, isAddition: true, content: 'const a = 1' })
    expect(additions[1]).toMatchObject({ newFileLineNumber: 2, isAddition: true, content: 'const b = 2' })
    expect(additions[2]).toMatchObject({ newFileLineNumber: 4, isAddition: true, content: 'const d = 4' })
  })

  it('includes context lines in output', () => {
    const lines = parseDiffLines(samplePatch)
    const contextLines = lines.filter(l => !l.isAddition)
    expect(contextLines).toHaveLength(1)
    expect(contextLines[0]).toMatchObject({ newFileLineNumber: 3, isAddition: false, content: 'const c = 3' })
  })

  it('does NOT include removal lines (starting with -)', () => {
    const lines = parseDiffLines(samplePatch)
    const lineNumbers = lines.map(l => l.newFileLineNumber)
    // Line 5 would be from the removed line, but removals don't advance the new file line counter
    expect(lines).toHaveLength(4) // 3 additions + 1 context
  })

  it('handles multiple hunks correctly', () => {
    const multiHunkPatch = `@@ -1,3 +1,3 @@
+const x = 1
 const y = 2
@@ -10,2 +10,2 @@
+const z = 10`
    const lines = parseDiffLines(multiHunkPatch)
    const lineNumbers = lines.map(l => l.newFileLineNumber)
    expect(lineNumbers).toContain(1)
    expect(lineNumbers).toContain(2)
    expect(lineNumbers).toContain(10)
  })

  it('returns empty array for patch with only hunk header but no changes', () => {
    const emptyHunk = '@@ -0,0 +1,0 @@'
    const lines = parseDiffLines(emptyHunk)
    // Hunk headers are skipped — no actual lines produced
    expect(lines).toHaveLength(0)
  })
})

// ─── buildValidLinesMap ───────────────────────────────────────────────────────

describe('buildValidLinesMap', () => {
  const makeFile = (filename: string, patch: string): ChangedFile => ({
    filename,
    patch,
    additions: 2,
    deletions: 0,
    status: 'added',
    language: 'typescript',
  })

  it('builds a map with correct filenames as keys', () => {
    const files = [
      makeFile('src/a.ts', '@@ -0,0 +1,2 @@\n+const x = 1\n+const y = 2'),
      makeFile('src/b.ts', '@@ -0,0 +1,1 @@\n+const z = 3'),
    ]
    const map = buildValidLinesMap(files)
    expect(map.has('src/a.ts')).toBe(true)
    expect(map.has('src/b.ts')).toBe(true)
  })

  it('includes the correct line numbers in each set', () => {
    const files = [makeFile('src/a.ts', '@@ -0,0 +1,3 @@\n+line1\n+line2\n+line3')]
    const map = buildValidLinesMap(files)
    const lines = map.get('src/a.ts')!
    expect(lines.has(1)).toBe(true)
    expect(lines.has(2)).toBe(true)
    expect(lines.has(3)).toBe(true)
    expect(lines.has(4)).toBe(false)
  })
})

// ─── annotateWithLineNumbers ──────────────────────────────────────────────────

describe('annotateWithLineNumbers', () => {
  it('annotates addition lines with [L{n}] markers', () => {
    const patch = '@@ -0,0 +1,2 @@\n+const x = 1\n+const y = 2'
    const result = annotateWithLineNumbers(patch)
    expect(result).toContain('[L1] +const x = 1')
    expect(result).toContain('[L2] +const y = 2')
  })

  it('does not annotate removal lines, only annotates additions', () => {
    const patch = '@@ -1,1 +1,1 @@\n-const old = 1\n+const new_ = 1'
    const result = annotateWithLineNumbers(patch)
    // Removal line passthrough without [L] marker
    expect(result).toContain('-const old = 1')
    expect(result).not.toContain('[L1] -const old') // removals NOT annotated
    // Addition line gets the [L{n}] annotation
    expect(result).toContain('[L1] +const new_ = 1')
  })

  it('preserves hunk headers unchanged', () => {
    const patch = '@@ -0,0 +1,1 @@\n+const x = 1'
    const result = annotateWithLineNumbers(patch)
    expect(result.split('\n')[0]).toBe('@@ -0,0 +1,1 @@')
  })
})
