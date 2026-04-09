# we_model_code — TradingView to Tradovate Webhook Bot

Automated futures trading bot. TradingView fires an alert, this server receives it, and places an order on Tradovate.

## Stack
- **Node.js / Express** — webhook server
- **Railway.app** — deployment
- **Tradovate API** — order execution
- **TradingView Pine Script** — signal source

## Quick Start

```bash
cp .env.example .env
# fill in your credentials
npm install
node server.js
```

## Webhook Payload

```json
{
  "secret": "YOUR_WEBHOOK_SECRET",
  "action": "buy",
  "symbol": "MNQM5",
  "qty": 1,
  "stopLoss": 21000.00,
  "takeProfit": 21100.00
}
```

## Health Check

GET / returns current server status, account ID, daily order count, and token expiry.

## AI Assistance

This repo is set up for Claude Code Action. Tag @claude in any issue or PR comment to request changes. See CLAUDE.md for full architecture docs.

## Disclaimer

This software is for educational and experimental purposes. Automated trading carries significant financial risk. Always test on demo before going live.
