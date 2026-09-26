// Loads configuration from environment + an optional .env file (no dependencies).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env parser: KEY=VALUE per line, ignores blanks/comments, strips quotes.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const ROOT_DIR = ROOT;
export const DATA_DIR = path.join(ROOT, 'data');
export const BLOB_DIR = path.join(DATA_DIR, 'blobs');

export const config = {
  port: num(process.env.PORT, 3000),
  baseUrl: (process.env.BASE_URL || `http://localhost:${num(process.env.PORT, 3000)}`).replace(/\/$/, ''),
  appSecret: process.env.APP_SECRET || 'insecure-dev-secret-change-me',
  storageBackend: (process.env.STORAGE_BACKEND || 'local').toLowerCase(),
  codeStyle: (process.env.CODE_STYLE || 'code').toLowerCase(),
  shareTtlHours: num(process.env.SHARE_TTL_HOURS, 24),
  // Per-file limit (default 15 MB) and total-per-share limit (default 60 MB).
  maxFileBytes: num(process.env.MAX_FILE_BYTES, 15 * 1024 * 1024),
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 60 * 1024 * 1024),
  maxDownloads: num(process.env.MAX_DOWNLOADS, 0),
  maxAttempts: num(process.env.MAX_ATTEMPTS, 10),
  // Optional dedicated key for at-rest file encryption (falls back to APP_SECRET).
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  // Keep this much of the Drive quota free for personal use (default 100 GB).
  driveReserveBytes: num(process.env.DRIVE_RESERVE_BYTES, 100 * 1024 * 1024 * 1024),
  gdrive: {
    clientId: process.env.GDRIVE_CLIENT_ID || '',
    clientSecret: process.env.GDRIVE_CLIENT_SECRET || '',
    refreshToken: process.env.GDRIVE_REFRESH_TOKEN || '',
    folderId: process.env.GDRIVE_FOLDER_ID || '',
  },
};

export function assertConfig() {
  const warnings = [];
  if (config.appSecret === 'insecure-dev-secret-change-me') {
    warnings.push('APP_SECRET is not set — using an insecure default. Set APP_SECRET in .env before production.');
  }
  if (config.storageBackend === 'gdrive') {
    const g = config.gdrive;
    if (!g.clientId || !g.clientSecret || !g.refreshToken) {
      warnings.push('STORAGE_BACKEND=gdrive but GDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN are incomplete. Run `npm run gdrive-auth`.');
    }
  }
  return warnings;
}
