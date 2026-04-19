<div align="center">

# 🤖 DevReplay

**AI-powered GitHub App for automated code review**

Leave inline comments directly on PR lines — bugs, security issues, and performance problems detected automatically.

[![CI/CD](https://github.com/pchrysostomou/DevReplay/actions/workflows/ci.yml/badge.svg)](https://github.com/pchrysostomou/DevReplay/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

</div>

---

## What it does

A developer opens a Pull Request. Within seconds, DevReplay:

1. Fetches the changed files from the PR diff
2. Reads files imported by the changed code (codebase context)
3. Sends everything to **Groq (Llama 3.3 70B)** for analysis
4. Posts **inline review comments** with "Apply suggestion" buttons

```
🔒 Security  SQL Injection Risk                       [line 11]
─────────────────────────────────────────────────────────────
The SQL query is built using string concatenation, making it
vulnerable to SQL injection. Based on the pattern in
src/utils/database.ts, use the existing parameterized query helper.

  Suggested change
  - const q = `SELECT * FROM users WHERE id = '${userId}'`
  + const q = `SELECT * FROM users WHERE id = $1`
  + const user = await db.query(q, [userId])

  [Apply suggestion]   [Add suggestion to batch]
                                     🤖 DevReplay AI Review
```

---

## Architecture

```
GitHub PR Event
      │
      ▼
 Smee / HTTPS ──→ POST /webhook (Express)
                        │
                  Signature verify (HMAC-SHA256)
                        │
                  Rate limit check (10/hr/repo)
                        │
              ┌─────────▼──────────┐
              │   PR Diff Fetch    │  ← GitHub REST API
              │ (max 10 files,     │
              │  500 diff lines)   │
              └─────────┬──────────┘
                        │
              ┌─────────▼──────────┐
              │  Context Builder   │  ← fetches imported files
              │  (relative imports │     from GitHub contents API
              │   → related files) │
              └─────────┬──────────┘
                        │
              ┌─────────▼──────────┐
              │   Groq AI Review   │  ← llama-3.3-70b-versatile
              │  (annotated diff + │    structured JSON output
              │   codebase context)│    temperature: 0.1
              └─────────┬──────────┘
                        │
              ┌─────────▼──────────┐
              │  Inline Comments   │  ← PR Review API
              │  (line validated,  │    "suggestion" blocks
              │   severity sorted) │    Apply suggestion button
              └────────────────────┘
```

---

## Tech Stack

| Layer          | Technology                            |
|----------------|---------------------------------------|
| Runtime        | Node.js 20 · TypeScript 5 · ESM       |
| Web framework  | Express 4                             |
| GitHub API     | `@octokit/app` v15                    |
| AI             | Groq API · Llama 3.3 70B Versatile    |
| Testing        | Vitest · 37 unit tests                |
| Build          | tsup (ESM output)                     |
| Deploy         | Railway · GitHub Actions CI/CD        |

---

## Quick Start (local dev)

### 1. Clone

```bash
git clone https://github.com/pchrysostomou/DevReplay.git
cd DevReplay
npm install
```

### 2. Create a GitHub App

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new)
2. Set **Webhook URL** to your Smee proxy (see step 4)
3. Set **Webhook Secret** to any strong string
4. Permissions:
   - **Pull requests**: Read & Write
   - **Contents**: Read-only (for context builder)
5. Subscribe to: `Pull request` events
6. Download the **Private Key** (`.pem` file)

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
GITHUB_APP_ID=         # From app settings page
GITHUB_PRIVATE_KEY=    # Contents of .pem, all on one line with \n
GITHUB_WEBHOOK_SECRET= # The secret you set in step 2
GROQ_API_KEY=          # From console.groq.com
PORT=3000
NODE_ENV=development
```

**Converting the private key to single-line format:**

```bash
# macOS / Linux
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private-key.pem

# Windows PowerShell
(Get-Content private-key.pem) -join '\n'
```

### 4. Start Smee webhook proxy

```bash
npx smee-client --url https://smee.io/YOUR_CHANNEL --target http://localhost:3000/webhook
```

> Get a free channel at [smee.io](https://smee.io/). Paste this URL as the Webhook URL in your GitHub App settings.

### 5. Run the server

```bash
npm run dev
```

```
[INFO] Initializing GitHub App {"appId":"..."}
[INFO] DevReplay webhook server running {"port":3000}
```

### 6. Install the App on a repo

Go to your GitHub App → **Install App** → select a repository.
Open a Pull Request with code changes. DevReplay will review it automatically.

---

## Deploy to Railway

### One-click (recommended)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/devreplay)

### Manual

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set the following environment variables in Railway dashboard:

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | Your GitHub App ID |
| `GITHUB_PRIVATE_KEY` | Private key (single-line with `\n`) |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret |
| `GROQ_API_KEY` | From [console.groq.com](https://console.groq.com) |
| `NODE_ENV` | `production` |

Update your GitHub App's **Webhook URL** to the Railway deployment URL:
```
https://your-app.railway.app/webhook
```

Add `RAILWAY_TOKEN` to your GitHub repository secrets for automatic CI/CD deploys.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_APP_ID` | ✅ | — | GitHub App numeric ID |
| `GITHUB_PRIVATE_KEY` | ✅ | — | RSA private key (PEM, single-line) |
| `GITHUB_WEBHOOK_SECRET` | ✅ | — | HMAC secret for webhook verification |
| `GROQ_API_KEY` | ✅ | — | Groq API key |
| `PORT` | | `3000` | Server port |
| `NODE_ENV` | | `development` | `development` or `production` |

---

## Rate Limiting

DevReplay limits reviews to **10 per hour per repository** to control API costs and prevent runaway requests. When the limit is reached, a friendly comment is posted on the PR explaining when it will reset.

> The rate limit state is in-memory and resets on server restart. Production deployments using multiple instances should migrate to Redis.

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{ status: "ok", ... }` |
| `POST` | `/webhook` | GitHub webhook receiver (signature-verified) |

---

## Development

```bash
npm run dev      # Start with tsx (hot reload-compatible)
npm run build    # Production build via tsup → dist/
npm run lint     # TypeScript strict type-check
npm test         # Vitest unit tests (37 tests, 3 suites)
```

### Project structure

```
src/
├── server.ts              # Express app + webhook dispatcher
├── types.ts               # Shared TypeScript interfaces
├── github/
│   ├── auth.ts            # @octokit/app initialization
│   ├── diffParser.ts      # Fetch PR diff, parse line numbers
│   └── commenter.ts       # Post inline review comments
├── handlers/
│   └── pullRequest.ts     # Full review pipeline (step 1→4)
├── ai/
│   └── reviewer.ts        # Groq integration, structured JSON
├── context/
│   └── builder.ts         # Fetch imported files from GitHub
└── utils/
    ├── logger.ts           # Structured JSON logger
    └── rateLimiter.ts      # In-memory rate limiting
```

---

## Roadmap

| Milestone | Status |
|-----------|--------|
| Webhook server · PR diff parsing · Smee local dev | ✅ |
| Groq AI review · Inline comments · Apply suggestion | ✅ |
| Context builder · Rate limiting · Cross-file analysis | ✅ |
| CI/CD · Railway deploy · Professional README | ✅ |

