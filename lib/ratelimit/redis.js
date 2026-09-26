// Shared fixed-window rate limiter backed by Upstash Redis. Works across all serverless
// invocations/instances. INCR the counter; set the window TTL on first hit; read PTTL
// only when the caller is blocked (to report Retry-After).
import { redis } from '../redis.js';

export async function rateLimit(key, limit, windowMs) {
  const k = `rl:${key}`;
  const count = await redis(['INCR', k]);
  if (count === 1) await redis(['PEXPIRE', k, windowMs]);
  const ok = count <= limit;
  let retryAfter = 0;
  if (!ok) {
    const pttl = await redis(['PTTL', k]);
    retryAfter = pttl > 0 ? pttl : windowMs;
  }
  return { ok, remaining: Math.max(0, limit - count), retryAfter };
}
