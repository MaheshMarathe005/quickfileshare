// Share lifecycle: create, verify (redeem code), download tokens, expiry cleanup.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { randomId, generateCode, codeKey, humanSize, sanitizeFilename } from './util.js';
import { encryptBuffer, decryptBuffer } from './crypto.js';
import * as store from './store.js';
import { getStorage } from './storage/index.js';

function now() { return Date.now(); }

// ---- download tokens (short-lived, HMAC-signed; authorize file GETs after verify) ----
function signDownloadToken(shareId, ttlMs = 10 * 60_000) {
  const payload = Buffer.from(JSON.stringify({ sid: shareId, exp: now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.appSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyDownloadToken(token, shareId) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', config.appSecret).update(payload).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { sid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return sid === shareId && now() < exp;
  } catch { return false; }
}

// ---- create ----
export async function createShare({ text = '', files = [] }) {
  if (files.length === 0 && !text.trim()) {
    const err = new Error('Nothing to share — add a file or a message.'); err.status = 400; throw err;
  }
  // Per-file size limit.
  for (const f of files) {
    if (f.buffer.length > config.maxFileBytes) {
      const err = new Error(`"${sanitizeFilename(f.filename)}" is ${humanSize(f.buffer.length)} — the per-file limit is ${humanSize(config.maxFileBytes)}.`);
      err.status = 413; throw err;
    }
  }
  // Total size limit.
  const total = files.reduce((n, f) => n + f.buffer.length, 0);
  if (total > config.maxUploadBytes) {
    const err = new Error(`Upload too large (${humanSize(total)}). Total limit is ${humanSize(config.maxUploadBytes)}.`);
    err.status = 413; throw err;
  }

  const storage = getStorage();
  // Respect the owner's reserved free space (Drive backend only).
  if (typeof storage.assertCapacity === 'function' && total > 0) {
    await storage.assertCapacity(total, config.driveReserveBytes);
  }

  const id = randomId(9);
  // Give each share its own folder/subdir so files stay grouped and cleanup is atomic.
  const container = typeof storage.createContainer === 'function'
    ? await storage.createContainer(`share-${id}`)
    : null;

  const storedFiles = [];
  for (const f of files) {
    const enc = encryptBuffer(f.buffer);              // encrypt before it touches storage
    const ref = await storage.put({ filename: f.filename, mime: 'application/octet-stream', buffer: enc.data, container });
    storedFiles.push({
      id: randomId(6),
      name: sanitizeFilename(f.filename),
      size: f.buffer.length,                          // original (plaintext) size
      mime: f.mime || 'application/octet-stream',
      backend: storage.name,
      ref,
      enc: { iv: enc.iv, tag: enc.tag, alg: enc.alg }, // needed to decrypt on download
    });
  }

  const code = generateCode();
  const record = {
    id,
    codeKey: codeKey(code),
    text: String(text || ''),
    files: storedFiles,
    container,
    createdAt: now(),
    expiresAt: now() + config.shareTtlHours * 3600_000,
    maxDownloads: config.maxDownloads,   // 0 = unlimited until expiry
    downloadCount: 0,
  };
  store.create(record);
  return {
    id,
    code,
    receiveUrl: `${config.baseUrl}/r`,
    expiresAt: record.expiresAt,
    fileCount: storedFiles.length,
    totalSize: total,
  };
}

// Public view of a share (never leaks storage refs or codeKey).
function publicView(rec, token) {
  return {
    id: rec.id,
    text: rec.text,
    files: rec.files.map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime })),
    expiresAt: rec.expiresAt,
    downloadToken: token,
  };
}

// ---- verify / redeem ----
export async function verifyCode(codeInput) {
  const rec = store.getByCodeKey(codeKey(codeInput));
  if (!rec) return { ok: false, status: 404, error: 'Invalid or expired code.' };
  if (now() >= rec.expiresAt) {
    await cleanupShare(rec.id);
    return { ok: false, status: 410, error: 'This share has expired.' };
  }
  if (rec.maxDownloads > 0 && rec.downloadCount >= rec.maxDownloads) {
    return { ok: false, status: 410, error: 'This share is no longer available (download limit reached).' };
  }
  store.update(rec.id, (r) => { r.downloadCount += 1; });
  const token = signDownloadToken(rec.id);
  return { ok: true, share: publicView(rec, token) };
}

// ---- download a single file (after token check, done in server) ----
export async function openFile(shareId, fileId) {
  const rec = store.getById(shareId);
  if (!rec) return null;
  if (now() >= rec.expiresAt) { await cleanupShare(shareId); return null; }
  const file = rec.files.find((f) => f.id === fileId);
  if (!file) return null;
  const storage = getStorage();
  const blob = await storage.get(file.ref);
  // Decrypt in memory (files are small, capped by maxFileBytes) then stream out.
  const plaintext = file.enc ? decryptBuffer({ ...file.enc, data: blob }) : blob;
  return { stream: Readable.from(plaintext), file };
}

// ---- cleanup / expiry ----
export async function cleanupShare(id) {
  const rec = store.getById(id);
  if (!rec) return;
  const storage = getStorage();
  for (const f of rec.files) {
    try { await storage.remove(f.ref); } catch (e) { console.error('[cleanup] remove failed:', e.message); }
  }
  if (rec.container && typeof storage.removeContainer === 'function') {
    try { await storage.removeContainer(rec.container); } catch (e) { console.error('[cleanup] removeContainer failed:', e.message); }
  }
  store.remove(id);
}

export async function sweepExpired() {
  const t = now();
  for (const rec of store.all()) {
    if (t >= rec.expiresAt) await cleanupShare(rec.id);
  }
}
