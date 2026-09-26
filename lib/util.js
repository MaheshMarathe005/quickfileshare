// Small helpers: ID/code generation, hashing, formatting. No dependencies.
import crypto from 'node:crypto';
import { config } from './config.js';

// Crockford base32 alphabet (no I, L, O, U to avoid ambiguity).
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Unguessable, URL-safe id for share records and files.
export function randomId(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Generate the human-shareable access code.
// "code"  -> 8 chars base32, grouped as XXXX-XXXX (~40 bits, strong as a sole secret)
// "digits"-> 6 numeric digits (familiar OTP, weaker; rely on rate limiting + expiry)
export function generateCode(style = config.codeStyle) {
  if (style === 'digits') {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += B32[crypto.randomInt(0, 32)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// Normalise a submitted code so formatting/casing doesn't matter.
export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

// Deterministic keyed hash of a code -> used both as a lookup index and verifier.
// Because we never store the plaintext code, a leaked metadata file does not reveal codes.
export function codeKey(code) {
  return crypto.createHmac('sha256', config.appSecret).update(normalizeCode(code)).digest('base64url');
}

// Constant-time string comparison.
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function humanSize(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(bytes) || 0, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function sanitizeFilename(name) {
  const base = String(name || 'file').replace(/[/\\]/g, '_').replace(/[\x00-\x1f]/g, '').trim();
  return base.slice(0, 200) || 'file';
}
