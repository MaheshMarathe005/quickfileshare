// POST /api/share — multipart upload (text + files). Serverless entrypoint (Vercel).
// NOTE: Vercel serverless functions cap the request body at ~4.5 MB, so large uploads
// must use a persistent host instead. See README "Deploying".
import { config } from '../lib/config.js';
import { securityHeaders, sendJson, clientIp, readRawBody } from '../lib/http-helpers.js';
import { handleShare } from '../lib/handlers.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const bodyBuffer = await readRawBody(req, config.maxUploadBytes + 2 * 1024 * 1024);
    const result = await handleShare({ contentType: req.headers['content-type'] || '', bodyBuffer, ip: clientIp(req) });
    res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', ...(result.headers || {}) });
    res.end(JSON.stringify(result.json));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api/share] error:', err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
  }
}
