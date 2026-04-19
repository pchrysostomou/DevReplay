// ─────────────────────────────────────────────────────────────────────────────
// src/server.ts — Express webhook server (the heart of DevReplay)
//
// Responsibilities:
//   1. Accept POST /webhook from GitHub (with raw body for signature check)
//   2. Verify HMAC-SHA256 signature — rejects anything not from GitHub
//   3. Dispatch pull_request events to the handler
//   4. Return 200 immediately — handler runs async in background
//   5. Health check at GET /health for Railway uptime monitoring
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config'
import express from 'express'
import { githubApp } from './github/auth.js'
import { handlePullRequest } from './handlers/pullRequest.js'
import { logger } from './utils/logger.js'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3000', 10)

// ── Health check ──────────────────────────────────────────────────────────────
// Railway uses this to confirm the process is alive
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'devreplay',
    timestamp: new Date().toISOString(),
  })
})

// ── Webhook endpoint ──────────────────────────────────────────────────────────
// MUST use express.raw() — we need the raw Buffer to verify the HMAC signature.
// If you use express.json() here, signature verification will fail.
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // ── 1. Extract GitHub headers ─────────────────────────────────────────
    const signature  = req.headers['x-hub-signature-256'] as string | undefined
    const eventName  = req.headers['x-github-event']      as string | undefined
    const deliveryId = req.headers['x-github-delivery']   as string | undefined

    if (!signature || !eventName || !deliveryId) {
      logger.warn('Webhook received with missing headers', { eventName, deliveryId })
      res.status(400).send('Missing required GitHub headers')
      return
    }

    // ── 2. Verify HMAC-SHA256 signature ───────────────────────────────────
    // This confirms the request genuinely came from GitHub using our shared secret.
    try {
      await githubApp.webhooks.verifyAndReceive({
        id:        deliveryId,
        name:      eventName as Parameters<typeof githubApp.webhooks.verifyAndReceive>[0]['name'],
        signature,
        payload:   req.body.toString(),
      })
    } catch (err) {
      logger.error('Webhook signature verification failed', {
        error: (err as Error).message,
        deliveryId,
        event: eventName,
      })
      res.status(401).send('Unauthorized — invalid webhook signature')
      return
    }

    // ── 3. Respond immediately — GitHub times out after 10 seconds ────────
    // The AI review can take 15-30 seconds, so we answer 200 and run async.
    res.status(200).send('OK')

    logger.info('Webhook received', { event: eventName, deliveryId })
  }
)

// ── Register PR event handler ─────────────────────────────────────────────────
// @octokit/app dispatches typed events after signature is verified.
// We use getInstallationOctokit() to get a REST-capable client for the specific
// installation — this gives us octokit.rest.* methods.
githubApp.webhooks.on('pull_request', async ({ payload }) => {
  const action = payload.action

  // Only process events that introduce new code
  if (!['opened', 'synchronize', 'reopened'].includes(action)) {
    logger.debug('Ignoring PR action', { action })
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const installationId = (payload as any).installation?.id as number | undefined
  if (!installationId) {
    logger.error('No installation ID in payload — cannot authenticate', {
      repo: payload.repository.full_name,
    })
    return
  }

  // Get a fully authenticated Octokit with .rest.* REST methods
  const octokit = await githubApp.getInstallationOctokit(installationId)

  // Fire-and-forget — errors are caught so they don't crash the process
  handlePullRequest(octokit as never, payload).catch((err: Error) => {
    logger.error('PR handler threw an unexpected error', {
      error: err.message,
      stack: err.stack,
      repo:  payload.repository.full_name,
      pr:    payload.pull_request.number,
    })
  })
})

// ── Unhandled webhook events (logged for debugging) ───────────────────────────
githubApp.webhooks.onError((error) => {
  logger.error('Webhook processing error', { error: error.message })
})

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`DevReplay webhook server running`, {
    port: PORT,
    env:  process.env.NODE_ENV ?? 'development',
    endpoints: {
      health:  `http://localhost:${PORT}/health`,
      webhook: `http://localhost:${PORT}/webhook`,
    },
  })
})

export default app
