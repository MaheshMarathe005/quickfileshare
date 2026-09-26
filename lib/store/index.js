// Selects the active metadata store backend based on config.storeBackend.
//   file  -> JSON on local disk (persistent single instance)
//   redis -> Upstash Redis over REST (serverless / multi-instance)
import { config } from '../config.js';
import * as file from './file.js';
import * as redis from './redis.js';

const backends = { file, redis };

export function getStore() {
  const backend = backends[config.storeBackend];
  if (!backend) {
    throw new Error(`Unknown STORE_BACKEND "${config.storeBackend}". Use "file" or "redis".`);
  }
  return backend;
}
