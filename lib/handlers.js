// Transport-agnostic request handlers. Both the persistent HTTP server (server.js) and
// the Vercel serverless functions (api/*) call these with plain inputs and get plain
// results back, so the business logic lives in exactly one place.
import { config } from './config.js';
import * as shares from './shares.js';
import { verifyDownloadToken } from './shares.js';
import { rateLimit } from './ratelimit/index.js';

export function configPayload() {
  return {
    maxFileBytes: config.maxFileBytes,
    maxUploadBytes: config.maxUploadBytes,
    shareTtlHours: config.shareTtlHours,
    codeStyle: config.codeStyle,
    storageBackend: config.storageBackend,
    encrypted: true,
  };
}

// POST /api/share — multipart body with `text` and repeated `files`.
export async function handleShare({ contentType, bodyBuffer, ip }) {
  const rl = await rateLimit(`share:${ip}`, 20, 60_000);
  if (!rl.ok) return { status: 429, json: { error: 'Too many uploads, slow down.' } };

  if (!contentType || !contentType.startsWith('multipart/form-data')) {
    return { status: 400, json: { error: 'Expected multipart/form-data.' } };
  }
  const form = await new Response(bodyBuffer, { headers: { 'content-type': contentType } }).formData();

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
  return { status: 201, json: result };
}

// POST /api/verify — JSON { code }.
export async function handleVerify({ bodyBuffer, ip }) {
  const rl = await rateLimit(`verify:${ip}`, config.maxAttempts, 5 * 60_000);
  if (!rl.ok) {
    return {
      status: 429,
      headers: { 'retry-after': String(Math.ceil(rl.retryAfter / 1000)) },
      json: { error: 'Too many attempts. Try again later.' },
    };
  }
  let code = '';
  try { code = JSON.parse((bodyBuffer && bodyBuffer.toString('utf8')) || '{}').code || ''; } catch { /* ignore */ }
  const result = await shares.verifyCode(code);
  if (!result.ok) return { status: result.status || 400, json: { error: result.error } };
  return { status: 200, json: result.share };
}

// GET /api/download/:shareId/:fileId?token= — returns the decrypted bytes to stream out.
// On success: { ok:true, file, buffer }. On failure: { ok:false, status, json }.
export async function handleDownload({ shareId, fileId, token }) {
  if (!verifyDownloadToken(token, shareId)) {
    return { ok: false, status: 403, json: { error: 'Invalid or expired download token. Enter the code again.' } };
  }
  const opened = await shares.openFile(shareId, fileId);
  if (!opened) return { ok: false, status: 404, json: { error: 'File not found.' } };
  return { ok: true, file: opened.file, buffer: opened.buffer };
}

// Delete every expired share (blobs + folder + metadata). Used by the cron sweep.
export async function runSweep() {
  const removed = await shares.sweepExpired();
  return { removed };
}
