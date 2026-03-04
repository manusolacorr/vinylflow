/**
 * vinyl.flow — IndexedDB persistence layer v2
 *
 * Stores:
 *   trackOverrides  — BPM/key data keyed by track ID
 *   djSetOrder      — ordered DJ set (single sentinel record)
 *   collection      — full raw Discogs releases + sync metadata
 */

import type { Track } from '@/lib/vinylflow/types';

const DB_NAME    = 'vinylflow';
const DB_VERSION = 2; // bumped for collection store

export interface TrackOverride {
  id:        string;
  bpm:       number | null;
  key:       string | null;
  bpmSource: 'guessed' | 'enriched' | 'manual' | null;
  keySource: 'guessed' | 'enriched' | 'manual' | null;
  updatedAt: number;
}

export interface CollectionMeta {
  _key:        '__collection__';
  releases:    unknown[];   // raw Discogs RawRelease[]
  syncedAt:    number;      // Date.now() of last full or incremental sync
  releaseIds:  Set<number>; // for fast duplicate detection (not persisted — reconstructed on load)
}

// ── Open / init ────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trackOverrides')) {
        db.createObjectStore('trackOverrides', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('djSet')) {
        db.createObjectStore('djSet', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('djSetOrder')) {
        db.createObjectStore('djSetOrder', { keyPath: '_key' });
      }
      if (!db.objectStoreNames.contains('collection')) {
        db.createObjectStore('collection', { keyPath: '_key' });
      }
      // v1→v2 migration: add collection store if upgrading
      void e;
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

function tx(store: string, mode: IDBTransactionMode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Collection persistence ─────────────────────────────────────────────────

const COLL_KEY = '__collection__';

/** Save the full raw collection + timestamp */
export async function saveCollection(releases: unknown[], syncedAt: number): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const store = await tx('collection', 'readwrite');
    await idbRequest(store.put({ _key: COLL_KEY, releases, syncedAt }));
  } catch { /* non-fatal */ }
}

/** Load saved collection. Returns null if nothing saved yet. */
export async function loadCollection(): Promise<{ releases: unknown[]; syncedAt: number } | null> {
  if (typeof window === 'undefined') return null;
  try {
    const store = await tx('collection');
    const record = await idbRequest<{ _key: string; releases: unknown[]; syncedAt: number } | undefined>(
      store.get(COLL_KEY)
    );
    return record ? { releases: record.releases, syncedAt: record.syncedAt } : null;
  } catch { return null; }
}

/** Merge new raw releases into the saved collection (prepend, dedup by id) */
export async function mergeCollection(newReleases: unknown[]): Promise<{ releases: unknown[]; syncedAt: number } | null> {
  if (typeof window === 'undefined') return null;
  try {
    const existing = await loadCollection();
    const existingIds = new Set((existing?.releases ?? []).map((r: unknown) => (r as { id: number }).id));
    const fresh = (newReleases as { id: number }[]).filter(r => !existingIds.has(r.id));
    if (fresh.length === 0) {
      // Nothing new — just update timestamp
      const syncedAt = Date.now();
      await saveCollection(existing?.releases ?? [], syncedAt);
      return { releases: existing?.releases ?? [], syncedAt };
    }
    const merged = [...fresh, ...(existing?.releases ?? [])];
    const syncedAt = Date.now();
    await saveCollection(merged, syncedAt);
    return { releases: merged, syncedAt };
  } catch { return null; }
}

// ── Track overrides ────────────────────────────────────────────────────────

export async function saveTrackOverride(t: Pick<Track, 'id' | 'bpm' | 'key' | 'bpmSource' | 'keySource'>): Promise<void> {
  if (typeof window === 'undefined') return;
  const store = await tx('trackOverrides', 'readwrite');
  await idbRequest(store.put({
    id: t.id, bpm: t.bpm, key: t.key,
    bpmSource: t.bpmSource, keySource: t.keySource,
    updatedAt: Date.now(),
  }));
}

export async function loadAllOverrides(): Promise<Map<string, TrackOverride>> {
  if (typeof window === 'undefined') return new Map();
  try {
    const store = await tx('trackOverrides');
    const all: TrackOverride[] = await idbRequest(store.getAll());
    return new Map(all.map(o => [o.id, o]));
  } catch { return new Map(); }
}

export async function deleteTrackOverride(id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const store = await tx('trackOverrides', 'readwrite');
  await idbRequest(store.delete(id));
}

export async function countOverrides(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  try {
    const store = await tx('trackOverrides');
    return await idbRequest(store.count());
  } catch { return 0; }
}

// ── DJ Set ─────────────────────────────────────────────────────────────────

const DJ_SET_KEY = '__djset__';

export async function saveDjSet(tracks: Track[]): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const store = await tx('djSetOrder', 'readwrite');
    await idbRequest(store.put({ _key: DJ_SET_KEY, tracks }));
  } catch { /* non-fatal */ }
}

export async function loadDjSet(): Promise<Track[]> {
  if (typeof window === 'undefined') return [];
  try {
    const store = await tx('djSetOrder');
    const record = await idbRequest<{ _key: string; tracks: Track[] } | undefined>(store.get(DJ_SET_KEY));
    return record?.tracks ?? [];
  } catch { return []; }
}
