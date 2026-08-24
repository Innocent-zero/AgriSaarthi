'use client';

import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'agrisaarthi';
const DB_VERSION = 1;

export interface FarmProfile {
  id: string;
  name: string;
  phone?: string;
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  state?: string;
  district?: string;
  village?: string;
  language: 'hi' | 'en';
  updatedAt: number;
}

export interface CachedAdvisory {
  key: string;
  payload: unknown;
  cachedAt: number;
}

export interface PendingSync {
  id?: number;
  endpoint: string;
  method: 'POST';
  body: unknown;
  queuedAt: number;
  attempts: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable during server rendering'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('profiles')) {
          database.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('advisories')) {
          const s = database.createObjectStore('advisories', { keyPath: 'key' });
          s.createIndex('cachedAt', 'cachedAt');
        }
        if (!database.objectStoreNames.contains('chat')) {
          database.createObjectStore('chat', { keyPath: 'id', autoIncrement: true });
        }
        if (!database.objectStoreNames.contains('outbox')) {
          database.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

// ── Farm profile ──
export async function saveProfile(profile: FarmProfile): Promise<void> {
  try {
    const d = await db();
    await d.put('profiles', { ...profile, updatedAt: Date.now() });
  } catch (e) {
    console.warn('[idb] saveProfile failed', e);
  }
}

export async function loadProfile(id = 'default'): Promise<FarmProfile | undefined> {
  try {
    const d = await db();
    return (await d.get('profiles', id)) as FarmProfile | undefined;
  } catch {
    return undefined;
  }
}

// ── Advisory cache (survives full offline) ──
export async function cacheAdvisory(key: string, payload: unknown): Promise<void> {
  try {
    const d = await db();
    await d.put('advisories', { key, payload, cachedAt: Date.now() } as CachedAdvisory);
  } catch (e) {
    console.warn('[idb] cacheAdvisory failed', e);
  }
}

export async function readAdvisory<T>(key: string, maxAgeMs = 21_600_000): Promise<T | null> {
  try {
    const d = await db();
    const rec = (await d.get('advisories', key)) as CachedAdvisory | undefined;
    if (!rec) return null;
    if (Date.now() - rec.cachedAt > maxAgeMs) return null;
    return rec.payload as T;
  } catch {
    return null;
  }
}

// ── Chat history ──
export async function appendChat(entry: { role: 'user' | 'assistant'; text: string; at: number }): Promise<void> {
  try {
    const d = await db();
    await d.add('chat', entry);
  } catch (e) {
    console.warn('[idb] appendChat failed', e);
  }
}

export async function recentChat(limit = 30): Promise<Array<{ role: 'user' | 'assistant'; text: string; at: number }>> {
  try {
    const d = await db();
    const all = await d.getAll('chat');
    return all.slice(-limit);
  } catch {
    return [];
  }
}

// ── Outbox: replay writes made while offline ──
export async function queueSync(endpoint: string, body: unknown): Promise<void> {
  try {
    const d = await db();
    await d.add('outbox', { endpoint, method: 'POST', body, queuedAt: Date.now(), attempts: 0 } as PendingSync);
  } catch (e) {
    console.warn('[idb] queueSync failed', e);
  }
}

export async function flushOutbox(
  sender: (endpoint: string, body: unknown) => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const d = await db();
    const items = (await d.getAll('outbox')) as PendingSync[];
    for (const item of items) {
      try {
        await sender(item.endpoint, item.body);
        if (item.id !== undefined) await d.delete('outbox', item.id);
        sent += 1;
      } catch {
        failed += 1;
        if (item.id !== undefined) {
          await d.put('outbox', { ...item, attempts: item.attempts + 1 });
        }
      }
    }
  } catch (e) {
    console.warn('[idb] flushOutbox failed', e);
  }
  return { sent, failed };
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await Promise.all(
    ['profiles', 'advisories', 'chat', 'outbox'].map((s) => d.clear(s)),
  );
}