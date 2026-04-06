// server.js — Tradovate Webhook Bot
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ─── CONFIG (set these as Railway environment variables) ───────────────────────
const CONFIG = {
  secret:             process.env.WEBHOOK_SECRET,
  tradovateUser:      process.env.TRADOVATE_USER,
  tradovatePass:      process.env.TRADOVATE_PASS,
  tradovateAppId:     process.env.TRADOVATE_APP_ID,
  tradovateAppVersion:'1.0',
  tradovateCid:       Number(process.env.TRADOVATE_CID),
  tradovateSecret:    process.env.TRADOVATE_SECRET,
  env:                process.env.TRADOVATE_ENV || 'demo', // 'demo' or 'live'
};

const BASE_URL = CONFIG.env === 'live'
  ? 'https://live.tradovateapi.com/v1'
  : 'https://demo.tradovateapi.com/v1';

let accessToken  = null;
let tokenExpiry  = null;
let accountId    = null;

// ─── AUTHENTICATE ──────────────────────────────────────────────────────────────
async function authenticate() {
  console.log(`[AUTH] Authenticating with Tradovate (${CONFIG.env})...`);
  const res = await axios.post(`${BASE_URL}/auth/accesstokenrequest`, {
    name:       CONFIG.tradovateUser,
    password:   CONFIG.tradovatePass,
    appId:      CONFIG.tradovateAppId,
    appVersion: CONFIG.tradovateAppVersion,
    cid:        CONFIG.tradovateCid,
    sec:        CONFIG.tradovateSecret,
  });

  accessToken = res.data.accessToken;
  // Tokens last ~90 min — we refresh at 80 min
  tokenExpiry = Date.now() + 80 * 60 * 1000;
  console.log('[AUTH] Authenticated successfully');

  // Grab account ID
  const acctRes = await axios.get(`${BASE_URL}/account/list`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  accountId = acctRes.data[0].id;
  console.log(`[AUTH] Using account ID: ${accountId}`);
}

// ─── TOKEN REFRESH (runs every 80 min) ────────────────────────────────────────
async function refreshToken() {
  try {
    const res = await axios.post(`${BASE_URL}/auth/renewaccesstoken`, {}, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    accessToken = res.data.accessToken;
    tokenExpiry = Date.now() + 80 * 60 * 1000;
    console.log('[AUTH] Token refreshed');
  } catch (err) {
    console.error('[AUTH] Refresh failed, re-authenticating...');
    await authenticate();
  }
}
setInterval(refreshToken, 80 * 60 * 1000);

// ─── ENSURE VALID TOKEN ────────────────────────────────────────────────────────
async function ensureAuth() {
  if (!accessToken || Date.now() >= tokenExpiry) {
    await authenticate();
  }
}

// ─── LOOK UP CONTRACT ──────────────────────────────────────────────────────────
async function getContractId(symbol) {
  const res = await axios.get(`${BASE_URL}/contract/find?name=${symbol}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.data || !res.data.id) throw new Error(`Contract not found: ${symbol}`);
  return res.data.id;
}

// ─── PLACE ORDER ──────────────────────────────────────────────────────────────
async function placeOrder({ action, symbol, qty, stopLoss, takeProfit }) {
  const contractId = await getContractId(symbol);

  const orderPayload = {
    accountId,
    contractId,
    action:      action === 'buy' ? 'Buy' : 'Sell',
    orderQty:    qty,
    orderType:   'Market',
    isAutomated: true,
  };

  console.log(`[ORDER] Placing ${action.toUpperCase()} ${qty}x ${symbol}...`);
  const res = await axios.post(`${BASE_URL}/order/placeorder`, orderPayload, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  console.log(`[ORDER] Response:`, JSON.stringify(res.data));

  // ── Attach bracket (stop + target) if provided ──
  if (res.data.orderId && (stopLoss || takeProfit)) {
    const bracketPayload = {
      orderId: res.data.orderId,
    };
    if (stopLoss)    bracketPayload.stopLoss    = { stopType: 'Stop', stopPrice: stopLoss };
    if (takeProfit)  bracketPayload.takeProfit   = { limitPrice: takeProfit };

    try {
      await axios.post(`${BASE_URL}/order/modifyorder`, bracketPayload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      console.log(`[ORDER] Bracket attached (SL: ${stopLoss}, TP: ${takeProfit})`);
    } catch (bracketErr) {
      console.warn('[ORDER] Bracket attach failed:', bracketErr.response?.data);
    }
  }

  return res.data;
}

// ─── RISK CHECKS ───────────────────────────────────────────────────────────────
let dailyOrderCount = 0;
let dailyPnL        = 0;

const MAX_DAILY_ORDERS = Number(process.env.MAX_DAILY_ORDERS) || 20;
const MAX_DAILY_LOSS   = Number(process.env.MAX_DAILY_LOSS)   || 500;

// Reset counters at midnight UTC
function scheduleReset() {
  const now       = new Date();
  const midnight  = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const msUntil   = midnight - now;
  setTimeout(() => {
    dailyOrderCount = 0;
    dailyPnL        = 0;
    console.log('[RISK] Daily counters reset');
    scheduleReset();
  }, msUntil);
}
scheduleReset();

// ─── WEBHOOK ENDPOINT ──────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const { action, symbol, qty = 1, secret, stopLoss, takeProfit } = req.body;

  console.log(`[WEBHOOK] Received:`, JSON.stringify(req.body));

  // 1. Validate secret
  if (!CONFIG.secret || secret !== CONFIG.secret) {
    console.warn('[WEBHOOK] Invalid secret — rejected');
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 2. Validate action
  if (!['buy', 'sell'].includes(action?.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid action — must be buy or sell' });
  }

  // 3. Validate symbol
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol' });
  }

  // 4. Risk: daily order cap
  if (dailyOrderCount >= MAX_DAILY_ORDERS) {
    console.warn('[RISK] Daily order limit reached — rejected');
    return res.status(429).json({ error: 'Daily order limit reached' });
  }

  // 5. Risk: daily loss limit
  if (dailyPnL <= -MAX_DAILY_LOSS) {
    console.warn('[RISK] Daily loss limit reached — rejected');
    return res.status(429).json({ error: 'Daily loss limit reached' });
  }

  try {
    await ensureAuth();

    const result = await placeOrder({
      action: action.toLowerCase(),
      symbol,
      qty:        Number(qty),
      stopLoss,
      takeProfit,
    });

    dailyOrderCount++;
    console.log(`[RISK] Daily orders: ${dailyOrderCount}/${MAX_DAILY_ORDERS}`);

    return res.json({ success: true, order: result });

  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.error('[ORDER] Failed:', detail);
    return res.status(500).json({ error: 'Order execution failed', detail });
  }
});

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:      'online',
    env:         CONFIG.env,
    account:     accountId ?? 'not yet authenticated',
    dailyOrders: `${dailyOrderCount}/${MAX_DAILY_ORDERS}`,
    dailyPnL:    `$${dailyPnL.toFixed(2)}`,
    tokenExpiry: tokenExpiry ? new Date(tokenExpiry).toISOString() : 'none',
  });
});

// ─── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
authenticate()
  .then(() => app.listen(PORT, () => console.log(`[SERVER] Listening on port ${PORT}`)))
  .catch(err => {
    console.error('[SERVER] Failed to authenticate on startup:', err.message);
    process.exit(1);
  });
