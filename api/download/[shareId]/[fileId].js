// GET /api/download/:shareId/:fileId?token= — streams the decrypted file bytes.
// Vercel maps the [shareId]/[fileId] path segments into req.query.
// NOTE: Vercel serverless responses are capped at ~4.5 MB; larger files need a
// persistent host. See README "Deploying".
import { securityHeaders, sendJson } from '../../../lib/http-helpers.js';
import { handleDownload } from '../../../lib/handlers.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { shareId, fileId, token } = req.query || {};
    const result = await handleDownload({ shareId, fileId, token });
    if (!result.ok) return sendJson(res, result.status, result.json);
    const { file, buffer } = result;
    res.writeHead(200, {
      'content-type': file.mime || 'application/octet-stream',
      'content-length': buffer.length,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'cache-control': 'no-store',
    });
    res.end(buffer);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api/download] error:', err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
  }
}
