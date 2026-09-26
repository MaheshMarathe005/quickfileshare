// POST /api/verify — redeem a code, returns the share view + short-lived download token.
import { securityHeaders, sendJson, clientIp, readRawBody } from '../lib/http-helpers.js';
import { handleVerify } from '../lib/handlers.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const bodyBuffer = await readRawBody(req, 4096);
    const result = await handleVerify({ bodyBuffer, ip: clientIp(req) });
    res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', ...(result.headers || {}) });
    res.end(JSON.stringify(result.json));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api/verify] error:', err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
  }
}
