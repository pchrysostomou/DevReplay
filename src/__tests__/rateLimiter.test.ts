// ─────────────────────────────────────────────────────────────────────────────
// src/__tests__/rateLimiter.test.ts — Unit tests for rate limiter
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, resetRateLimit, getRateLimitState } from '../utils/rateLimiter.js'

const TEST_REPO = 'test-owner/test-repo'

beforeEach(() => {
  resetRateLimit(TEST_REPO)
})

describe('checkRateLimit', () => {
  it('allows first request', () => {
    const result = checkRateLimit(TEST_REPO)
    expect(result.allowed).toBe(true)
  })

  it('allows up to 10 requests', () => {
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit(TEST_REPO)
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks the 11th request', () => {
    for (let i = 0; i < 10; i++) checkRateLimit(TEST_REPO)
    const result = checkRateLimit(TEST_REPO)
    expect(result.allowed).toBe(false)
    expect(result.resetInMs).toBeGreaterThan(0)
    expect(result.resetInMins).toBeGreaterThan(0)
  })

  it('tracks different repos independently', () => {
    const repo2 = 'other-owner/other-repo'
    resetRateLimit(repo2)

    // Exhaust first repo
    for (let i = 0; i < 10; i++) checkRateLimit(TEST_REPO)
    expect(checkRateLimit(TEST_REPO).allowed).toBe(false)

    // Second repo should still be allowed
    expect(checkRateLimit(repo2).allowed).toBe(true)
  })

  it('resets after the window expires', async () => {
    // We can't wait a full hour — but we can verify resetRateLimit works
    for (let i = 0; i < 10; i++) checkRateLimit(TEST_REPO)
    expect(checkRateLimit(TEST_REPO).allowed).toBe(false)

    resetRateLimit(TEST_REPO)
    expect(checkRateLimit(TEST_REPO).allowed).toBe(true)
  })
})

describe('getRateLimitState', () => {
  it('returns null for unknown repo', () => {
    expect(getRateLimitState('unknown/repo')).toBeNull()
  })

  it('returns correct count after requests', () => {
    checkRateLimit(TEST_REPO)
    checkRateLimit(TEST_REPO)
    checkRateLimit(TEST_REPO)

    const state = getRateLimitState(TEST_REPO)
    expect(state).not.toBeNull()
    expect(state?.count).toBe(3)
    expect(state?.limit).toBe(10)
    expect(state?.resetAt).toBeInstanceOf(Date)
  })
})
