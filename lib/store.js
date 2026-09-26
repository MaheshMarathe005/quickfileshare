// Metadata store for share records: in-memory maps persisted to a JSON file.
// Writes are serialized and atomic (temp file + rename). Suitable for a single
// instance MVP. For multi-instance/high scale, swap this for a real database.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'metadata.json');
const TMP = FILE + '.tmp';

let shares = new Map();       // id -> record
let byCodeKey = new Map();    // codeKey -> id
let writeChain = Promise.resolve();

function reindex() {
  byCodeKey = new Map();
  for (const rec of shares.values()) {
    if (rec.codeKey) byCodeKey.set(rec.codeKey, rec.id);
  }
}

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      shares = new Map(arr.map((r) => [r.id, r]));
    } catch (e) {
      console.error('[store] could not parse metadata.json, starting empty:', e.message);
      shares = new Map();
    }
  }
  reindex();
}

function persist() {
  const snapshot = JSON.stringify([...shares.values()]);
  writeChain = writeChain.then(async () => {
    await fsp.writeFile(TMP, snapshot);
    await fsp.rename(TMP, FILE);
  }).catch((e) => console.error('[store] persist failed:', e.message));
  return writeChain;
}

export function create(record) {
  shares.set(record.id, record);
  if (record.codeKey) byCodeKey.set(record.codeKey, record.id);
  persist();
  return record;
}

export function getById(id) {
  return shares.get(id) || null;
}

export function getByCodeKey(key) {
  const id = byCodeKey.get(key);
  return id ? shares.get(id) || null : null;
}

// Apply a mutation function to a record and persist.
export function update(id, mutate) {
  const rec = shares.get(id);
  if (!rec) return null;
  mutate(rec);
  persist();
  return rec;
}

export function remove(id) {
  const rec = shares.get(id);
  if (!rec) return false;
  shares.delete(id);
  if (rec.codeKey) byCodeKey.delete(rec.codeKey);
  persist();
  return true;
}

export function all() {
  return [...shares.values()];
}

export function flush() {
  return writeChain;
}
