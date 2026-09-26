// GET/POST /api/cron/sweep — deletes expired shares (blobs + folder + metadata).
// Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET: Vercel sends
// "Authorization: Bearer <CRON_SECRET>" automatically when that env var is set.
import { config } from '../../lib/config.js';
import { securityHeaders, sendJson } from '../../lib/http-helpers.js';
import { runSweep } from '../../lib/handlers.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (config.cronSecret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${config.cronSecret}`) return sendJson(res, 401, { error: 'Unauthorized' });
  }
  try {
    const { removed } = await runSweep();
    sendJson(res, 200, { ok: true, removed });
  } catch (err) {
    console.error('[api/cron/sweep] error:', err);
    sendJson(res, 500, { error: err.message || 'Sweep failed' });
  }
}
