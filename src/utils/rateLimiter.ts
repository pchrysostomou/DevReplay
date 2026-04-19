// ─────────────────────────────────────────────────────────────────────────────
// src/utils/rateLimiter.ts — In-memory rate limiter (10 reviews / hour / repo)
//
// For W3, this is a simple in-memory store — state resets on server restart,
// which is fine for a single-process dev/Railway deployment.
// W4+ could swap this for Redis with no interface changes.
// ─────────────────────────────────────────────────────────────────────────────

/** Max reviews allowed per repo within the rolling window */
const LIMIT = 10

/** Rolling window duration in milliseconds (1 hour) */
const WINDOW_MS = 60 * 60 * 1000

interface RateLimitEntry {
  count:   number
  resetAt: number  // epoch ms when the window resets
}

// repo fullName (e.g. "pchrysostomou/devreplay-test") → entry
const store = new Map<string, RateLimitEntry>()

export interface RateLimitResult {
  allowed:     boolean
  resetInMs?:  number   // set when allowed === false
  resetInMins?: number  // human-readable, set when allowed === false
}

/**
 * Check if a repo is rate-limited and increment its counter if not.
 * Always increments on the first call within a window.
 */
export function checkRateLimit(repoFullName: string): RateLimitResult {
  const now = Date.now()
  const entry = store.get(repoFullName)

  // First call or expired window → fresh entry
  if (!entry || now > entry.resetAt) {
    store.set(repoFullName, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true }
  }

  if (entry.count >= LIMIT) {
    const resetInMs = entry.resetAt - now
    return {
      allowed:     false,
      resetInMs,
      resetInMins: Math.ceil(resetInMs / 60_000),
    }
  }

  entry.count++
  return { allowed: true }
}

/** Returns the current state for a repo without modifying it (for logging/testing) */
export function getRateLimitState(repoFullName: string): { count: number; limit: number; resetAt: Date } | null {
  const entry = store.get(repoFullName)
  if (!entry || Date.now() > entry.resetAt) return null
  return { count: entry.count, limit: LIMIT, resetAt: new Date(entry.resetAt) }
}

/** Clears the rate limit for a repo (useful for testing) */
export function resetRateLimit(repoFullName: string): void {
  store.delete(repoFullName)
}
