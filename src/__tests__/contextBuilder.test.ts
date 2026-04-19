// ─────────────────────────────────────────────────────────────────────────────
// src/__tests__/contextBuilder.test.ts — Unit tests for context builder
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { extractImports, resolveImportPath } from '../context/builder.js'

describe('extractImports', () => {
  it('extracts relative imports from diff additions', () => {
    const patch = `@@ -0,0 +1,5 @@
+import { db } from './database'
+import type { User } from '../types/user'
+import express from 'express'`
    const result = extractImports(patch)
    expect(result).toContain('./database')
    expect(result).toContain('../types/user')
    // node_modules import should NOT be included
    expect(result).not.toContain('express')
  })

  it('extracts require() style imports', () => {
    const patch = `@@ -0,0 +1,3 @@
+const { helper } = require('./utils/helper')`
    const result = extractImports(patch)
    expect(result).toContain('./utils/helper')
  })

  it('ignores removed lines (starting with -)', () => {
    const patch = `@@ -1,3 +1,3 @@
-import { old } from './old-module'
+import { new_ } from './new-module'`
    const result = extractImports(patch)
    expect(result).not.toContain('./old-module')
    expect(result).toContain('./new-module')
  })

  it('deduplicates imports that appear multiple times', () => {
    const patch = `@@ -0,0 +1,4 @@
+import { a } from './shared'
+import { b } from './shared'`
    const result = extractImports(patch)
    expect(result.filter(r => r === './shared')).toHaveLength(1)
  })

  it('returns empty array for patches with no imports', () => {
    const patch = `@@ -0,0 +1,2 @@
+const x = 1
+const y = 2`
    expect(extractImports(patch)).toHaveLength(0)
  })

  it('ignores non-relative imports (node_modules, absolute paths)', () => {
    const patch = `@@ -0,0 +1,3 @@
+import React from 'react'
+import { z } from 'zod'
+import path from 'node:path'`
    expect(extractImports(patch)).toHaveLength(0)
  })
})

describe('resolveImportPath', () => {
  it('resolves a simple relative import from nested file', () => {
    const candidates = resolveImportPath('src/api/controller.ts', './database')
    expect(candidates).toContain('src/api/database.ts')
    expect(candidates).toContain('src/api/database.tsx')
    expect(candidates).toContain('src/api/database/index.ts')
  })

  it('resolves parent directory import (../)', () => {
    const candidates = resolveImportPath('src/api/controller.ts', '../types/user')
    expect(candidates).toContain('src/types/user.ts')
    expect(candidates).toContain('src/types/user.tsx')
  })

  it('returns single candidate when import has explicit extension', () => {
    const candidates = resolveImportPath('src/server.ts', './utils/logger.ts')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toBe('src/utils/logger.ts')
  })

  it('handles deeply nested files', () => {
    const candidates = resolveImportPath('src/modules/auth/handlers/login.ts', '../../utils/hash')
    expect(candidates).toContain('src/modules/utils/hash.ts')
  })
})
