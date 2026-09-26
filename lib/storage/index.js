// Selects the active storage backend based on config.storageBackend.
import { config } from '../config.js';
import * as local from './local.js';
import * as gdrive from './gdrive.js';

const backends = { local, gdrive };

export function getStorage() {
  const backend = backends[config.storageBackend];
  if (!backend) {
    throw new Error(`Unknown STORAGE_BACKEND "${config.storageBackend}". Use "local" or "gdrive".`);
  }
  return backend;
}
