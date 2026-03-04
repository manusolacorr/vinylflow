/**
 * vinyl.flow — IndexedDB persistence layer
 *
 * Two stores:
 *   trackOverrides  — BPM/key data keyed by track ID, merged onto releases after load
 *   djSet           — ordered array of Track IDs + full track objects for the current set
 *
 * All methods are safe to call server-side (they no-op when window is undefined).
 */

import type { Track } from '@/lib/vinylflow/types';

const DB_NAME    = 'vinylflow';
const DB_VERSION = 1;

export interface TrackOverride {
  id:        string;
  bpm:       number | null;
  key:       string | null;
  bpmSource: 'guessed' | 'enriched' | 'manual' | null;
  keySource: 'guessed' | 'enriched' | 'manual' | null;
  updatedAt: number;
}

// ── Open / init ────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trackOverrides')) {
        db.createObjectStore('trackOverrides', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('djSet')) {
        db.createObjectStore('djSet', { keyPath: 'id' });
        // Separate store for ordered set (we store a single sentinel record)
        db.createObjectStore('djSetOrder', { keyPath: '_key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

function tx(store: string, mode: IDBTransactionMode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

// ── Track overrides ────────────────────────────────────────────────────────

/** Save BPM/key for one track */
export async function saveTrackOverride(t: Pick<Track, 'id' | 'bpm' | 'key' | 'bpmSource' | 'keySource'>): Promise<void> {
  if (typeof window === 'undefined') return;
  const store = await tx('trackOverrides', 'readwrite');
  const record: TrackOverride = {
    id:        t.id,
    bpm:       t.bpm,
    key:       t.key,
    bpmSource: t.bpmSource,
    keySource: t.keySource,
    updatedAt: Date.now(),
  };
  await idbRequest(store.put(record));
}

/** Load all saved overrides as a map { trackId → TrackOverride } */
export async function loadAllOverrides(): Promise<Map<string, TrackOverride>> {
  if (typeof window === 'undefined') return new Map();
  try {
    const store = await tx('trackOverrides');
    const all: TrackOverride[] = await idbRequest(store.getAll());
    return new Map(all.map(o => [o.id, o]));
  } catch {
    return new Map();
  }
}

/** Delete a single override (when user resets a track) */
export async function deleteTrackOverride(id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const store = await tx('trackOverrides', 'readwrite');
  await idbRequest(store.delete(id));
}

/** How many overrides are saved */
export async function countOverrides(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  try {
    const store = await tx('trackOverrides');
    return await idbRequest(store.count());
  } catch { return 0; }
}

// ── DJ Set persistence ─────────────────────────────────────────────────────

const DJ_SET_KEY = '__djset__';

/** Save the full ordered DJ set */
export async function saveDjSet(tracks: Track[]): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const store = await tx('djSetOrder', 'readwrite');
    await idbRequest(store.put({ _key: DJ_SET_KEY, tracks }));
  } catch { /* non-fatal */ }
}

/** Restore the DJ set, returns [] if nothing saved */
export async function loadDjSet(): Promise<Track[]> {
  if (typeof window === 'undefined') return [];
  try {
    const store = await tx('djSetOrder');
    const record = await idbRequest<{ _key: string; tracks: Track[] } | undefined>(store.get(DJ_SET_KEY));
    return record?.tracks ?? [];
  } catch { return []; }
}

// ── Utility ────────────────────────────────────────────────────────────────

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
