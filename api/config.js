// GET /api/config — UI configuration (limits, TTL, backend, encrypted flag).
import { securityHeaders, sendJson } from '../lib/http-helpers.js';
import { configPayload } from '../lib/handlers.js';

export default function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  sendJson(res, 200, configPayload());
}
