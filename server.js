// mahesh_fs — zero-dependency file/text sharing server.
// Sender uploads files + text -> gets a one-time code. Receiver enters the code
// -> downloads the files. Storage backend is pluggable (local disk or Google Drive).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { config, assertConfig, ROOT_DIR } from './lib/config.js';
import * as store from './lib/store.js';
import * as shares from './lib/shares.js';
import { getStorage } from './lib/storage/index.js';
import { rateLimit } from './lib/ratelimit.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'");
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Read a request body into a Buffer, aborting if it exceeds maxBytes.
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

// ---- API handlers ----
async function handleShare(req, res) {
  const ip = clientIp(req);
  const rl = rateLimit(`share:${ip}`, 20, 60_000);
  if (!rl.ok) return sendJson(res, 429, { error: 'Too many uploads, slow down.' });

  const ctype = req.headers['content-type'] || '';
  if (!ctype.startsWith('multipart/form-data')) {
    return sendJson(res, 400, { error: 'Expected multipart/form-data.' });
  }
  // Allow the multipart envelope a little headroom over the raw file cap.
  const buf = await readBody(req, config.maxUploadBytes + 2 * 1024 * 1024);
  const form = await new Response(buf, { headers: { 'content-type': ctype } }).formData();

  const text = String(form.get('text') || '').replace(/\r\n/g, '\n');
  const files = [];
  for (const value of form.getAll('files')) {
    if (typeof value === 'string') continue;
    files.push({
      filename: value.name || 'file',
      mime: value.type || 'application/octet-stream',
      buffer: Buffer.from(await value.arrayBuffer()),
    });
  }
  const result = await shares.createShare({ text, files });
  sendJson(res, 201, result);
}

async function handleVerify(req, res) {
  const ip = clientIp(req);
  const rl = rateLimit(`verify:${ip}`, config.maxAttempts, 5 * 60_000);
  if (!rl.ok) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfter / 1000));
    return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
  }
  const buf = await readBody(req, 4096);
  let code = '';
  try { code = JSON.parse(buf.toString('utf8') || '{}').code || ''; } catch { /* ignore */ }
  const result = await shares.verifyCode(code);
  if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
  sendJson(res, 200, result.share);
}

async function handleDownload(req, res, shareId, fileId, token) {
  if (!shares.verifyDownloadToken(token, shareId)) {
    return sendJson(res, 403, { error: 'Invalid or expired download token. Enter the code again.' });
  }
  const opened = await shares.openFile(shareId, fileId);
  if (!opened) return sendJson(res, 404, { error: 'File not found.' });
  const { stream, file } = opened;
  res.writeHead(200, {
    'content-type': file.mime || 'application/octet-stream',
    'content-length': file.size,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'cache-control': 'no-store',
  });
  stream.on('error', (e) => { console.error('[download] stream error:', e.message); res.destroy(); });
  stream.pipe(res);
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
    if (method === 'GET' && p === '/api/config') {
      return sendJson(res, 200, {
        maxFileBytes: config.maxFileBytes,
        maxUploadBytes: config.maxUploadBytes,
        shareTtlHours: config.shareTtlHours,
        codeStyle: config.codeStyle,
        storageBackend: config.storageBackend,
        encrypted: true,
      });
    }
    if (method === 'POST' && p === '/api/share') return await handleShare(req, res);
    if (method === 'POST' && p === '/api/verify') return await handleVerify(req, res);

    const dl = p.match(/^\/api\/download\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && dl) {
      return await handleDownload(req, res, decodeURIComponent(dl[1]), decodeURIComponent(dl[2]), url.searchParams.get('token'));
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
  store.load();
  const storage = getStorage();
  if (storage.init) await storage.init();

  for (const w of assertConfig()) console.warn('[config] ' + w);

  // Periodic expiry sweep.
  shares.sweepExpired().catch(() => {});
  setInterval(() => shares.sweepExpired().catch(() => {}), 15 * 60_000).unref();

  server.listen(config.port, () => {
    console.log(`mahesh_fs listening on ${config.baseUrl}`);
    console.log(`  storage: ${config.storageBackend} | code style: ${config.codeStyle} | TTL: ${config.shareTtlHours}h`);
  });
}

main().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
