// Redis-backed metadata store (Upstash REST) for serverless / multi-instance use.
// Layout:
//   share:<id>        -> JSON record            (EX: share TTL + grace)
//   codekey:<codeKey> -> <id>                   (EX: share TTL + grace)  code -> share lookup
//   shares:index      -> ZSET member=<id> score=<expiresAt ms>   (drives the cron sweep)
// The short EX is a safety net; the cron sweep is what deletes the Drive blobs on expiry.
import { config } from '../config.js';
import { redis, redisPipeline } from '../redis.js';

export const name = 'redis';

const shareKey = (id) => `share:${id}`;
const codeKeyKey = (ck) => `codekey:${ck}`;
const INDEX = 'shares:index';

function ttlSeconds(record) {
  const graceMs = config.shareGraceHours * 3600_000;
  return Math.max(60, Math.ceil((record.expiresAt + graceMs - Date.now()) / 1000));
}

export async function init() {
  // Fail fast if credentials are wrong.
  await redis(['PING']);
}

export async function create(record) {
  const ex = ttlSeconds(record);
  const json = JSON.stringify(record);
  await redisPipeline([
    ['SET', shareKey(record.id), json, 'EX', ex],
    ...(record.codeKey ? [['SET', codeKeyKey(record.codeKey), record.id, 'EX', ex]] : []),
    ['ZADD', INDEX, record.expiresAt, record.id],
  ]);
  return record;
}

export async function getById(id) {
  const raw = await redis(['GET', shareKey(id)]);
  return raw ? JSON.parse(raw) : null;
}

export async function getByCodeKey(key) {
  const id = await redis(['GET', codeKeyKey(key)]);
  return id ? getById(id) : null;
}

// Read-modify-write. Not atomic (fine for our low-contention counter); preserves the
// existing TTL via SET ... KEEPTTL so the share still expires on schedule.
export async function update(id, mutate) {
  const rec = await getById(id);
  if (!rec) return null;
  await mutate(rec);
  await redis(['SET', shareKey(id), JSON.stringify(rec), 'KEEPTTL']);
  return rec;
}

export async function remove(id) {
  const rec = await getById(id);
  const cmds = [['DEL', shareKey(id)], ['ZREM', INDEX, id]];
  if (rec && rec.codeKey) cmds.push(['DEL', codeKeyKey(rec.codeKey)]);
  await redisPipeline(cmds);
  return !!rec;
}

async function loadMany(ids) {
  if (!ids.length) return [];
  const raws = await redis(['MGET', ...ids.map(shareKey)]);
  const out = [];
  const orphans = [];
  ids.forEach((id, i) => {
    const raw = raws[i];
    if (raw) out.push(JSON.parse(raw));
    else orphans.push(id);           // index entry whose record already expired/evicted
  });
  if (orphans.length) await redis(['ZREM', INDEX, ...orphans]).catch(() => {});
  return out;
}

export async function all() {
  const ids = await redis(['ZRANGE', INDEX, 0, -1]);
  return loadMany(ids || []);
}

export async function listExpired(nowMs) {
  const ids = await redis(['ZRANGEBYSCORE', INDEX, 0, nowMs]);
  return loadMany(ids || []);
}

export async function flush() { /* writes are synchronous over REST — nothing to flush */ }
