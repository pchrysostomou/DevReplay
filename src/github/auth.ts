// ─────────────────────────────────────────────────────────────────────────────
// src/github/auth.ts — GitHub App authentication via @octokit/app
//
// Creates and exports the singleton App instance. @octokit/app handles:
//   - JWT generation from App ID + Private Key
//   - Installation token exchange (per-repo short-lived tokens)
//   - Automatic token refresh before expiry
//   - Built-in webhook signature verification
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '@octokit/app'
import { logger } from '../utils/logger.js'

function getPrivateKey(): string {
  const key = process.env.GITHUB_PRIVATE_KEY

  if (!key) {
    throw new Error('GITHUB_PRIVATE_KEY is not set in environment variables')
  }

  // Railway / most hosting platforms store multiline values with literal \n
  // We normalize them back to real newlines for the PEM parser
  return key.replace(/\\n/g, '\n')
}

function createGitHubApp(): App {
  const appId = process.env.GITHUB_APP_ID
  const secret = process.env.GITHUB_WEBHOOK_SECRET

  if (!appId) throw new Error('GITHUB_APP_ID is not set')
  if (!secret) throw new Error('GITHUB_WEBHOOK_SECRET is not set')

  logger.info('Initializing GitHub App', { appId })

  return new App({
    appId,
    privateKey: getPrivateKey(),
    webhooks: {
      secret,
    },
  })
}

// Singleton — created once at startup
export const githubApp: App = createGitHubApp()
