/**
 * Redis connection + cache helpers.
 * Falls back to a bounded in-process LRU when REDIS_URL is absent, so local
 * development and Render free-tier previews never hard-fail on cache misses.
 */
import Redis from 'ioredis';

type CacheEntry = { value: string; expiresAt: number };

const MEMORY_LIMIT = 500;
const memory = new Map<string, CacheEntry>();

let client: Redis | null = null;
let redisHealthy = false;

export function initRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[redis] REDIS_URL not set — using in-process cache fallback');
    return null;
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 250, 2000)),
  });

  client.on('connect', () => {
    redisHealthy = true;
    console.log('[redis] connected');
  });
  client.on('error', (err) => {
    redisHealthy = false;
    console.error('[redis] error:', err.message);
  });
  client.on('close', () => {
    redisHealthy = false;
  });

  return client;
}

function memGet(key: string): string | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  if (memory.size >= MEMORY_LIMIT) {
    // Prefer evicting an already-expired entry over the oldest-inserted one —
    // pure FIFO eviction let a long-TTL-but-still-valid entry (e.g. a fresh
    // soil-data lookup, TTL 7 days) get evicted to make room while a
    // long-expired short-TTL entry (e.g. stale weather, TTL 30 min) sat
    // untouched simply because it happened to be inserted more recently.
    const now = Date.now();
    let victim: string | undefined;
    for (const [k, v] of memory) {
      if (v.expiresAt <= now) { victim = k; break; }
    }
    victim ??= memory.keys().next().value;
    if (victim) memory.delete(victim);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = redisHealthy && client ? await client.get(key) : memGet(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.error('[redis] get failed:', (err as Error).message);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const raw = JSON.stringify(value);
  try {
    if (redisHealthy && client) {
      await client.set(key, raw, 'EX', ttlSeconds);
    } else {
      memSet(key, raw, ttlSeconds);
    }
  } catch (err) {
    console.error('[redis] set failed:', (err as Error).message);
    memSet(key, raw, ttlSeconds);
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    if (redisHealthy && client) await client.del(key);
  } catch { /* non-fatal */ }
  memory.delete(key);
}

/** Read-through cache wrapper. */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return { data: hit, cached: true };
  const data = await producer();
  await cacheSet(key, data, ttlSeconds);
  return { data, cached: false };
}

export function redisStatus(): 'connected' | 'fallback' {
  return redisHealthy ? 'connected' : 'fallback';
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = null;
    redisHealthy = false;
  }
}