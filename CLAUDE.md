# CLAUDE.md — Agent Context for we_model_code

This file tells Claude (and any AI agent) everything it needs to work reliably in this repository. Keep it up-to-date whenever the architecture, env vars, or deployment target changes.

---

## What This Repo Is

A **TradingView to Tradovate automated futures trading bot**.

Three-component pipeline:

    TradingView Pine Script alert
            (HTTP POST JSON)
    Node.js / Express webhook server   <- this repo
            (REST API)
    Tradovate order execution (demo or live)

The server runs on **Railway.app** and is triggered exclusively by TradingView webhook alerts.

---

## File Map

| File | Purpose |
|------|----------|
| server.js | Main Express server — auth, webhook handler, risk guards, order placement |
| package.json | Node deps (express, axios) + start script |
| WE_MODEL_FIXED.pine | Pine Script strategy that fires TradingView alerts |
| .github/workflows/claude.yml | Claude Code Action — triggered by @claude in issue/PR comments |
| CLAUDE.md | This file — AI agent context |
| .env.example | Template for required environment variables (never commit real values) |
| .gitignore | Ensures .env and node_modules are never committed |

---

## Architecture and Key Logic (server.js)

### Authentication
- On startup, calls POST /auth/accesstokenrequest — stores accessToken + accountId
- Token auto-refreshes every 80 minutes via setInterval — POST /auth/renewaccesstoken
- Falls back to full re-auth if refresh fails
- ensureAuth() is called before every order

### Webhook Endpoint — POST /webhook
Accepts JSON body:
  secret: YOUR_WEBHOOK_SECRET
  action: buy or sell
  symbol: e.g. ESM5
  qty: number (default 1)
  stopLoss: optional price
  takeProfit: optional price

Validation order: secret -> action -> symbol -> daily order cap -> daily loss limit -> place order.

### Order Placement
- Resolves symbol string to contract ID via GET /contract/find?name=
- Places market order via POST /order/placeorder
- Optionally attaches bracket (SL/TP) via POST /order/modifyorder

### Risk Guards (in-memory, resets at midnight UTC)
| Guard | Env Var | Default |
|-------|---------|--------|
| Max daily orders | MAX_DAILY_ORDERS | 20 |
| Max daily loss ($) | MAX_DAILY_LOSS | 500 |

WARNING: These counters are in-memory only. A server restart resets them. Railway restarts frequently — do not rely on these as hard safety limits for live trading without a persistent store (Redis, DB, etc).

### Health Check — GET /
Returns JSON: env, account ID, daily order count, daily PnL, token expiry.

---

## Environment Variables

All secrets are injected via Railway environment variables. Never hardcode or commit these.

| Variable | Required | Description |
|----------|----------|-------------|
| WEBHOOK_SECRET | YES | Shared secret validated on every incoming webhook |
| TRADOVATE_USER | YES | Tradovate account username |
| TRADOVATE_PASS | YES | Tradovate account password |
| TRADOVATE_APP_ID | YES | App ID from Tradovate developer portal |
| TRADOVATE_CID | YES | Client ID (numeric) |
| TRADOVATE_SECRET | YES | Client secret from Tradovate developer portal |
| TRADOVATE_ENV | YES | demo or live — controls which API base URL is used |
| MAX_DAILY_ORDERS | optional | Default: 20 |
| MAX_DAILY_LOSS | optional | Default: 500 (USD) |
| PORT | optional | Default: 3000 (Railway sets this automatically) |

GitHub Action secrets (Settings -> Secrets -> Actions):
| Secret | Purpose |
|--------|--------|
| ANTHROPIC_API_KEY | Claude Code Action |
| APP_ID | GitHub App ID for token generation |
| APP_PRIVATE_KEY | GitHub App private key |

---

## Deployment (Railway)

- Platform: Railway.app
- Start command: npm start -> node server.js
- Build: No build step — pure Node.js
- Required Railway env vars: all variables listed above

To deploy a change: push to main -> Railway auto-deploys.

To test locally:
  cp .env.example .env
  npm install
  node server.js

---

## Testing the Webhook Locally

  curl -X POST http://localhost:3000/webhook \\
    -H "Content-Type: application/json" \\
    -d '{"secret":"YOUR_SECRET","action":"buy","symbol":"MNQM5","qty":1}'

---

## How Claude Works in This Repo

The @claude trigger in .github/workflows/claude.yml lets Claude Code Action respond to issue and PR comments.

To invoke Claude:
1. Open or comment on any Issue or Pull Request
2. Tag @claude followed by your request
3. Claude opens a PR with changes on a claude- prefixed branch

Examples:
- @claude add input validation for the qty field to reject non-integers
- @claude refactor placeOrder to support limit orders
- @claude write a test for the webhook secret validation
- @claude explain what happens if the Tradovate token expires mid-request

What Claude can safely do:
- Add/modify server logic in server.js
- Update package.json deps
- Improve error handling and logging
- Add new endpoints
- Write tests

What Claude should NOT do without explicit instruction:
- Change TRADOVATE_ENV from demo to live
- Modify or remove risk guard logic
- Change the webhook secret validation
- Touch .github/workflows/ unless explicitly asked

---

## Known Issues and Tech Debt

1. In-memory risk counters reset on any process restart. Move to Redis for production.
2. No test suite — zero automated tests. Any PR from Claude should include tests.
3. No package-lock.json — add this for reproducible installs.
4. No rate limiting on /webhook beyond the daily order cap.
5. dailyPnL counter is declared but never updated — daily loss guard is non-functional.
6. No .gitignore — node_modules and .env could be accidentally committed.
7. No README.md — no entry point for new contributors.
8. Bracket attach endpoint needs verification against current Tradovate API docs.

---

## Instruments Reference

| Symbol | Contract |
|--------|---------|
| ESM5 | E-mini S&P 500 (Jun 2025) |
| NQM5 | E-mini Nasdaq-100 (Jun 2025) |
| MESM5 | Micro E-mini S&P 500 (Jun 2025) |
| MNQM5 | Micro E-mini Nasdaq-100 (Jun 2025) |
| CLM5 | Crude Oil (Jun 2025) |

Update symbols each quarter rollover.
