// mahesh_fs — persistent HTTP server (local dev + persistent hosts: Render/Railway/Fly/VPS).
// Sender uploads files + text -> gets a one-time code. Receiver enters the code -> downloads.
// Serverless (Vercel) uses the same core logic through the functions in /api instead.
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, assertConfig, ROOT_DIR, IS_SERVERLESS } from './lib/config.js';
import { getStore } from './lib/store/index.js';
import { getStorage } from './lib/storage/index.js';
import * as handlers from './lib/handlers.js';
import { securityHeaders, sendJson, clientIp, readStreamBody } from './lib/http-helpers.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};

async function serveStatic(res, relPath) {
  const safe = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, safe);
  if (!full.startsWith(PUBLIC_DIR)) { sendJson(res, 403, { error: 'Forbidden' }); return; }
  try {
    const data = await fsp.readFile(full);
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

function writeResult(res, result) {
  const headers = { 'content-type': 'application/json; charset=utf-8', ...(result.headers || {}) };
  res.writeHead(result.status, headers);
  res.end(JSON.stringify(result.json));
}

// ---- router ----
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  // Treat HEAD like GET for routing, but suppress the response body.
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (req.method === 'HEAD') {
    const origEnd = res.end.bind(res);
    res.write = () => true;
    res.end = (chunk, encoding, cb) => {
      const callback = [chunk, encoding, cb].find((a) => typeof a === 'function');
      return origEnd(callback);
    };
  }
  try {
    if (method === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(res, 'index.html');
    if (method === 'GET' && (p === '/r' || p === '/receive' || p === '/receive.html')) return serveStatic(res, 'receive.html');
    if (method === 'GET' && p === '/healthz') return sendJson(res, 200, { ok: true });
    if (method === 'GET' && p === '/api/config') return sendJson(res, 200, handlers.configPayload());

    if (method === 'POST' && p === '/api/share') {
      const bodyBuffer = await readStreamBody(req, config.maxUploadBytes + 2 * 1024 * 1024);
      return writeResult(res, await handlers.handleShare({ contentType: req.headers['content-type'] || '', bodyBuffer, ip: clientIp(req) }));
    }
    if (method === 'POST' && p === '/api/verify') {
      const bodyBuffer = await readStreamBody(req, 4096);
      return writeResult(res, await handlers.handleVerify({ bodyBuffer, ip: clientIp(req) }));
    }

    const dl = p.match(/^\/api\/download\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && dl) {
      const result = await handlers.handleDownload({
        shareId: decodeURIComponent(dl[1]),
        fileId: decodeURIComponent(dl[2]),
        token: url.searchParams.get('token'),
      });
      if (!result.ok) return writeResult(res, result);
      const { file, buffer } = result;
      res.writeHead(200, {
        'content-type': file.mime || 'application/octet-stream',
        'content-length': buffer.length,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'cache-control': 'no-store',
      });
      return res.end(buffer);
    }

    // Static assets (css/js/images) under /public root.
    if (method === 'GET' && /\.(css|js|svg|ico|png|jpg|jpeg|webp|gif|json)$/.test(p)) return serveStatic(res, p.slice(1));

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[server] error:', err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
    else res.destroy();
  }
});

async function main() {
  const store = getStore();
  if (store.init) await store.init();
  const storage = getStorage();
  if (storage.init) await storage.init();

  for (const w of assertConfig()) console.warn('[config] ' + w);

  // Periodic expiry sweep (persistent process only; on serverless a cron hits /api/cron/sweep).
  handlers.runSweep().catch(() => {});
  setInterval(() => handlers.runSweep().catch(() => {}), 15 * 60_000).unref();

  server.listen(config.port, () => {
    console.log(`mahesh_fs listening on ${config.baseUrl}`);
    console.log(`  storage: ${config.storageBackend} | store: ${config.storeBackend} | code: ${config.codeStyle} | TTL: ${config.shareTtlHours}h`);
  });
}

// On Vercel/Lambda this file must never run: the app is served by the static
// public/ assets + the functions in api/. Starting a listener there (and the
// file store's mkdir of a read-only path) is exactly what caused the
// "ENOENT: mkdir '/var/task/data'" crash. Guard so importing/bundling is inert.
if (IS_SERVERLESS) {
  console.warn('[server] Serverless environment detected — not starting a persistent listener. ' +
    'Requests are handled by the functions in api/. Ensure STORE_BACKEND=redis and STORAGE_BACKEND=gdrive.');
} else {
  main().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
}
