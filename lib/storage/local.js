// Local disk storage backend. Each share gets its own subfolder under data/blobs/.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BLOB_DIR } from '../config.js';
import { randomId } from '../util.js';

export const name = 'local';

export async function init() {
  await fsp.mkdir(BLOB_DIR, { recursive: true });
}

// Create a per-share container (subfolder). Returns an opaque ref { dir }.
export async function createContainer(label) {
  const dir = String(label).replace(/[^a-zA-Z0-9_-]/g, '_');
  await fsp.mkdir(path.join(BLOB_DIR, dir), { recursive: true });
  return { dir };
}

// Store a buffer inside a container. Returns a storage ref { key, dir }.
export async function put({ buffer, container }) {
  const dir = container?.dir || '';
  const key = randomId(16);
  await fsp.writeFile(path.join(BLOB_DIR, dir, key), buffer);
  return { key, dir };
}

// Read a stored blob back as a Buffer.
export async function get(ref) {
  return fsp.readFile(path.join(BLOB_DIR, ref.dir || '', ref.key));
}

export async function remove(ref) {
  try {
    await fsp.unlink(path.join(BLOB_DIR, ref.dir || '', ref.key));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

export async function removeContainer(container) {
  if (!container?.dir) return;
  await fsp.rm(path.join(BLOB_DIR, container.dir), { recursive: true, force: true });
}
