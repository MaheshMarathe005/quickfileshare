// GET /api/healthz — health check.
import { securityHeaders, sendJson } from '../lib/http-helpers.js';

export default function handler(req, res) {
  securityHeaders(res);
  sendJson(res, 200, { ok: true });
}
