// Picks the rate-limiter backend: Redis when it's configured (shared across serverless
// instances), otherwise the per-process in-memory limiter. `rateLimit` is always async.
import { redisConfigured } from '../config.js';
import { rateLimit as memoryLimit } from './memory.js';
import { rateLimit as redisLimit } from './redis.js';

export function rateLimit(key, limit, windowMs) {
  const impl = redisConfigured() ? redisLimit : memoryLimit;
  return impl(key, limit, windowMs);
}
