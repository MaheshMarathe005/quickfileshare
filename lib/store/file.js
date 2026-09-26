// File-backed metadata store: in-memory maps persisted to a JSON file with atomic
// (temp file + rename) writes. Great for a single persistent instance (local dev,
// Render/Railway/Fly/VPS). For serverless/multi-instance use the redis store instead.
// The API is async so it matches the redis backend and callers can `await` uniformly.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

export const name = 'file';

const FILE = path.join(DATA_DIR, 'metadata.json');
const TMP = FILE + '.tmp';

let shares = new Map();       // id -> record
let byCodeKey = new Map();    // codeKey -> id
let writeChain = Promise.resolve();
let loaded = false;

function reindex() {
  byCodeKey = new Map();
  for (const rec of shares.values()) {
    if (rec.codeKey) byCodeKey.set(rec.codeKey, rec.id);
  }
}

export async function init() {
  if (loaded) return;
  // Never let a read-only filesystem (e.g. a serverless deploy that forgot to set
  // STORE_BACKEND=redis) hard-crash the process on mkdir. Degrade to in-memory.
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error(`[store:file] cannot create data dir "${DATA_DIR}" (${e.code}). ` +
      'Running in-memory only — on Vercel/Lambda set STORE_BACKEND=redis + STORAGE_BACKEND=gdrive.');
    loaded = true;
    return;
  }
  if (fs.existsSync(FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      shares = new Map(arr.map((r) => [r.id, r]));
    } catch (e) {
      console.error('[store:file] could not parse metadata.json, starting empty:', e.message);
      shares = new Map();
    }
  }
  reindex();
  loaded = true;
}

function persist() {
  const snapshot = JSON.stringify([...shares.values()]);
  writeChain = writeChain.then(async () => {
    await fsp.writeFile(TMP, snapshot);
    await fsp.rename(TMP, FILE);
  }).catch((e) => console.error('[store:file] persist failed:', e.message));
  return writeChain;
}

export async function create(record) {
  shares.set(record.id, record);
  if (record.codeKey) byCodeKey.set(record.codeKey, record.id);
  await persist();
  return record;
}

export async function getById(id) {
  return shares.get(id) || null;
}

export async function getByCodeKey(key) {
  const id = byCodeKey.get(key);
  return id ? shares.get(id) || null : null;
}

// Apply a mutation to a record and persist. `mutate` may be sync or async.
export async function update(id, mutate) {
  const rec = shares.get(id);
  if (!rec) return null;
  await mutate(rec);
  await persist();
  return rec;
}

export async function remove(id) {
  const rec = shares.get(id);
  if (!rec) return false;
  shares.delete(id);
  if (rec.codeKey) byCodeKey.delete(rec.codeKey);
  await persist();
  return true;
}

export async function all() {
  return [...shares.values()];
}

export async function listExpired(nowMs) {
  return [...shares.values()].filter((r) => nowMs >= r.expiresAt);
}

export async function flush() {
  return writeChain;
}
