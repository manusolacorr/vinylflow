
'use client';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import EssentiaAnalyser from './EssentiaAnalyser';
import { saveTrackOverride, loadAllOverrides, saveDjSet, loadDjSet, countOverrides } from '@/lib/db';
import {
  ROLES, ROLE_IDS, assignRole, roleOf,
  camCompat, bpmBridge, compatColor,
  pitchDrift, sameSide, decadeOf, visualCue, guessBPM,
  engine1BuildSet, engine2SortSet, setSuggestions,
} from '@/lib/vinylflow';
import type { Track, Release } from '@/lib/vinylflow';

interface User { id: number; username: string; avatar_url: string; }
interface CollectionPage {
  pagination: { pages: number; items: number; page: number };
  releases: RawRelease[];
}
interface RawRelease {
  id: number;
  basic_information: {
    id: number; title: string;
    artists: { name: string }[];
    genres: string[]; styles: string[];
    year: number; thumb: string;
    labels: { name: string }[];
  };
}
interface ReleaseDetail {
  id: number; title: string; artist: string;
  tracks: { position: string; title: string; duration: string; artist: string; notesBpm: number | null }[];
  notesBpm: number | null;
  genres: string[]; styles: string[]; year: number; thumb: string | null;
}

function makeTrack(
  releaseId: number, releaseTitle: string, releaseArtist: string,
  pos: string, title: string, duration: string, trackArtist: string,
  thumb: string | null, year: number, genres: string[], styles: string[],
  bpm: number | null,
): Track {
  return {
    id: `${releaseId}_${pos}`,
    title, pos, trackArtist, duration,
    bpm, bpmSource: bpm ? 'guessed' : null,
    key: null, keySource: null, roleOverride: null,
    releaseId, releaseTitle, releaseArtist,
    thumb, year, genres, styles,
  };
}

function flattenRaw(rawReleases: RawRelease[]): Release[] {
  return rawReleases.map(r => {
    const bi = r.basic_information;
    const artist = (bi.artists || []).map((a: { name: string }) => a.name.replace(/\s*\(\d+\)$/, '')).join(', ') || 'Unknown';
    const label = (bi.labels || []).map((l: { name: string }) => l.name).join(', ') || '';
    const bpm = guessBPM(bi.genres || [], bi.styles || []);
    const track = makeTrack(bi.id, bi.title, artist, 'A1', bi.title, '', artist, bi.thumb || null, bi.year || 0, bi.genres || [], bi.styles || [], bpm);
    return { id: bi.id, title: bi.title, artist, genres: bi.genres || [], styles: bi.styles || [], year: bi.year || 0, label, thumb: bi.thumb || null, tracks: [track] };
  });
}

function allTracks(releases: Release[]): Track[] { return releases.flatMap(r => r.tracks); }

const PAGE = 30;
// ── Exact Vercel/Geist design tokens ──────────────────────────────────────
// Light: white base, #eaeaea borders, #666 muted, #0070f3 blue accent
// Dark:  #1a1a1a base (soft grey, not black), #333 borders, #888 muted
const THEMES = {
  light: {
    bg:         '#ffffff',
    surface:    '#ffffff',
    surface2:   '#fafafa',
    surface3:   '#f2f2f2',
    border:     '#eaeaea',
    borderHover:'#999999',
    text:       '#000000',
    muted:      '#666666',
    subtle:     '#999999',
    // Vercel blue for all UI chrome: buttons, active states, links
    accent:     '#0070f3',
    accentHover:'#0060df',
    accentFg:   '#ffffff',
    accentGlow: 'rgba(0,112,243,0.08)',
    // DJ-purpose only: role colors stay in ROLES, BPM/key use these
    djAmber:    '#f5a623',
    djAmberFg:  '#000000',
    green:      '#0070f3',   // vercel uses blue for success too
    greenAlt:   '#29bc9b',   // teal for confirmed data
    red:        '#ee0000',
    warning:    '#f5a623',
    shadow:     '0 0 0 1px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)',
    shadowMd:   '0 4px 16px rgba(0,0,0,0.10)',
  },
  dark: {
    // Soft grey — Vercel dashboard dark, NOT pure black
    bg:         '#1a1a1a',
    surface:    '#1a1a1a',
    surface2:   '#242424',
    surface3:   '#2e2e2e',
    border:     '#333333',
    borderHover:'#666666',
    text:       '#ededed',
    muted:      '#888888',
    subtle:     '#444444',
    accent:     '#0070f3',
    accentHover:'#3291ff',
    accentFg:   '#ffffff',
    accentGlow: 'rgba(0,112,243,0.12)',
    djAmber:    '#f5a623',
    djAmberFg:  '#000000',
    green:      '#3291ff',
    greenAlt:   '#29bc9b',
    red:        '#ff4444',
    warning:    '#f5a623',
    shadow:     '0 0 0 1px rgba(255,255,255,0.06)',
    shadowMd:   '0 4px 16px rgba(0,0,0,0.5)',
  },
};
type ThemeKey = keyof typeof THEMES;

// ── Minimal SVG icons (Lucide-style, 16×16 stroke) ────────────────────────
const Icon = {
  music:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  edit:     <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>,
  download: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  sun:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  moon:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  label:    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  save:     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  mic:      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  file:     <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>,
  print:    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
  filter:   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
  bolt:     <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  chevronL: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  chevronR: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  x:        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  logout:   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

export default function DashboardClient({ user }: { user: User }) {
  // ── Theme ──────────────────────────────────────────────────────────────
  const [themeKey, setThemeKey] = useState<ThemeKey>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem('vf-theme') as ThemeKey) || 'light';
  });
  const toggleTheme = () => setThemeKey(k => {
    const next = k === 'light' ? 'dark' : 'light';
    localStorage.setItem('vf-theme', next);
    return next;
  });
  const T = THEMES[themeKey];
  const chip = (active: boolean, color: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 10px', height: 28, borderRadius: 6, fontSize: '0.7rem', fontWeight: 500, cursor: 'pointer', border: `1px solid ${active ? color : T.border}`, background: active ? color : 'transparent', color: active ? '#fff' : T.muted, whiteSpace: 'nowrap', transition: 'all 0.15s', letterSpacing: '-0.01em' });
  const btn = (v: 'primary' | 'secondary' | 'ghost' = 'secondary'): React.CSSProperties => ({ display:'inline-flex', alignItems:'center', gap:5, padding: '0 12px', height:32, borderRadius: 6, fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer', letterSpacing: '-0.01em', border: v === 'ghost' ? 'none' : `1px solid ${v === 'primary' ? 'transparent' : T.border}`, background: v === 'primary' ? T.accent : v === 'ghost' ? 'transparent' : T.surface, color: v === 'primary' ? T.accentFg : T.text, transition: 'background 0.15s, border-color 0.15s, color 0.15s' });

  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState('');
  const [error, setError] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState('');
  const [enrichProgress, setEnrichProgress] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilters, setRoleFilters] = useState<Set<string>>(new Set());
  const [genreFilters, setGenreFilters] = useState<Set<string>>(new Set());
  const [decadeFilters, setDecadeFilters] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [djSet, setDjSet] = useState<Track[]>([]);
  const [tab, setTab] = useState<'library' | 'set' | 'analysis' | 'stickers'>('library');
  const [stickerSource, setStickerSource] = useState<'collection' | 'set'>('collection');
  const [page, setPage] = useState(1);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBpm, setEditBpm] = useState('');
  const [editKey, setEditKey] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const djSetSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── IndexedDB: restore on mount ──────────────────────────────────────────
  useEffect(() => {
    // Restore DJ set
    loadDjSet().then(saved => { if (saved.length > 0) setDjSet(saved); });
    // Show how many overrides are cached
    countOverrides().then(n => setSavedCount(n));
  }, []);

  // ── IndexedDB: apply overrides whenever releases change ──────────────────
  useEffect(() => {
    if (releases.length === 0) return;
    loadAllOverrides().then(overrides => {
      if (overrides.size === 0) return;
      setReleases(prev => prev.map(r => ({
        ...r,
        tracks: r.tracks.map(t => {
          const o = overrides.get(t.id);
          if (!o) return t;
          // Only apply if override is newer than a guessed value
          if (o.bpmSource === 'guessed' && t.bpmSource !== 'guessed') return t;
          return { ...t, bpm: o.bpm ?? t.bpm, key: o.key ?? t.key, bpmSource: o.bpmSource, keySource: o.keySource };
        }),
      })));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releases.length]); // only re-run when collection is (re)loaded

  // ── IndexedDB: persist DJ set (debounced 500ms) ──────────────────────────
  useEffect(() => {
    if (djSetSaveTimer.current) clearTimeout(djSetSaveTimer.current);
    djSetSaveTimer.current = setTimeout(() => { saveDjSet(djSet); }, 500);
    return () => { if (djSetSaveTimer.current) clearTimeout(djSetSaveTimer.current); };
  }, [djSet]);

  const allGenres  = useMemo(() => Array.from(new Set(releases.flatMap(r => r.genres))).sort(), [releases]);
  const allDecades = useMemo(() => Array.from(new Set(releases.map(r => decadeOf(r.year)))).sort(), [releases]);

  const filteredTracks = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allTracks(releases).filter(t => {
      if (roleFilters.size > 0 && !roleFilters.has(assignRole(t))) return false;
      if (genreFilters.size > 0 && !Array.from(genreFilters).some(g => (t.genres||[]).includes(g))) return false;
      if (decadeFilters.size > 0 && !decadeFilters.has(decadeOf(t.year))) return false;
      if (!q) return true;
      return [t.title, t.trackArtist, t.releaseTitle, t.pos, t.key||'', String(t.bpm||''), ...(t.genres||[]), ...(t.styles||[])].some(f => f && f.toLowerCase().includes(q));
    });
  }, [releases, search, roleFilters, genreFilters, decadeFilters]);

  const pagedTracks = filteredTracks.slice((page-1)*PAGE, page*PAGE);
  const totalPages  = Math.ceil(filteredTracks.length / PAGE);
  const inSet = useCallback((id: string) => djSet.some(t => t.id === id), [djSet]);

  async function loadCollection() {
    setLoading(true); setError(''); setLoadMsg('Connecting to Discogs...');
    try {
      const res1 = await fetch('/api/collection?page=1&per_page=100');
      if (!res1.ok) { if (res1.status === 401) { window.location.href = '/'; return; } throw new Error(`HTTP ${res1.status}`); }
      const d1: CollectionPage = await res1.json();
      const { pages } = d1.pagination;
      let raw = [...d1.releases];
      for (let p = 2; p <= pages; p++) {
        setLoadMsg(`Loading page ${p} of ${pages}...`);
        const r = await fetch(`/api/collection?page=${p}&per_page=100`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d: CollectionPage = await r.json();
        raw = [...raw, ...d.releases];
        await new Promise(res => setTimeout(res, 120));
      }
      setReleases(flattenRaw(raw));
      setTab('library');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Unknown error'); }
    finally { setLoading(false); setLoadMsg(''); }
  }

  async function expandTracklists() {
    setEnriching(true); setEnrichProgress(0);
    const total = releases.length;
    let workingReleases = [...releases];

    for (let i = 0; i < workingReleases.length; i++) {
      setEnrichMsg(`Tracklists: ${i+1}/${total} — ${workingReleases[i].title.slice(0,28)}...`);
      setEnrichProgress(Math.round((i / total) * 40));
      try {
        const res = await fetch(`/api/release/${workingReleases[i].id}`);
        if (res.ok) {
          const detail: ReleaseDetail = await res.json();
          if (detail.tracks?.length > 0) {
            workingReleases[i] = {
              ...workingReleases[i],
              tracks: detail.tracks.map(t => makeTrack(
                detail.id, detail.title, detail.artist,
                t.position, t.title, t.duration, t.artist,
                detail.thumb || workingReleases[i].thumb,
                detail.year || workingReleases[i].year,
                detail.genres || workingReleases[i].genres,
                detail.styles || workingReleases[i].styles,
                detail.notesBpm || guessBPM(detail.genres || workingReleases[i].genres, detail.styles || workingReleases[i].styles),
              )),
            };
          }
        }
      } catch { /* skip */ }
      if (i % 10 === 9) setReleases([...workingReleases]);
      await new Promise(r => setTimeout(r, 200));
    }
    setReleases([...workingReleases]);
    setEnrichProgress(40);

    const allT = workingReleases.flatMap(r => r.tracks);
    const total2 = allT.length;
    const trackMap: Record<string, { bpm: number | null; key: string | null }> = {};
    const BATCH = 5;

    for (let i = 0; i < allT.length; i += BATCH) {
      const batch = allT.slice(i, i + BATCH);
      setEnrichMsg(`BPM/Key: ${Math.min(i+BATCH, total2)}/${total2} tracks...`);
      setEnrichProgress(40 + Math.round((i / total2) * 60));

      await Promise.all(batch.map(async t => {
        try {
          const res = await fetch('/api/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artist: t.trackArtist, title: t.title, genres: t.genres || [], styles: t.styles || [] }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.bpm || data.key) trackMap[t.id] = { bpm: data.bpm, key: data.key };
          }
        } catch { /* skip */ }
      }));

      if (Object.keys(trackMap).length > 0) {
        workingReleases = workingReleases.map(r => ({
          ...r,
          tracks: r.tracks.map(t => {
            const e = trackMap[t.id];
            if (!e) return t;
            return { ...t, bpm: e.bpm ?? t.bpm, bpmSource: e.bpm ? 'enriched' as const : t.bpmSource, key: e.key ?? t.key, keySource: e.key ? 'enriched' as const : t.keySource };
          }),
        }));
        setReleases([...workingReleases]);
        setDjSet(prev => prev.map(t => { const e = trackMap[t.id]; if (!e) return t; return { ...t, bpm: e.bpm ?? t.bpm, bpmSource: e.bpm ? 'enriched' as const : t.bpmSource, key: e.key ?? t.key, keySource: e.key ? 'enriched' as const : t.keySource }; }));
        // Persist enriched data to IndexedDB
        const newEntries = Object.entries(trackMap);
        await Promise.all(newEntries.map(([id, e]) => saveTrackOverride({ id, bpm: e.bpm, key: e.key, bpmSource: 'enriched', keySource: 'enriched' })));
        setSavedCount(await countOverrides());
      }
      await new Promise(r => setTimeout(r, 400));
    }
    setEnriching(false); setEnrichMsg(''); setEnrichProgress(0);
  }

  function addToSet(t: Track) { if (!inSet(t.id)) setDjSet(s => [...s, t]); }
  function removeFromSet(id: string) { setDjSet(s => s.filter(t => t.id !== id)); }
  function moveUp(i: number) { if (i===0) return; setDjSet(s => { const a=[...s]; [a[i-1],a[i]]=[a[i],a[i-1]]; return a; }); }
  function moveDown(i: number) { setDjSet(s => { if (i>=s.length-1) return s; const a=[...s]; [a[i],a[i+1]]=[a[i+1],a[i]]; return a; }); }

  function handleAnalysisResult(trackId: string, bpm: number, key: string) {
    const update = (t: Track) => t.id === trackId ? { ...t, bpm, key, bpmSource: 'enriched' as const, keySource: 'enriched' as const } : t;
    setReleases(prev => prev.map(r => ({ ...r, tracks: r.tracks.map(update) })));
    setDjSet(prev => prev.map(update));
    setAnalysingId(null);
    saveTrackOverride({ id: trackId, bpm, key, bpmSource: 'enriched', keySource: 'enriched' });
    setSavedCount(n => n + 1);
  }

  function openEdit(t: Track) {
    setEditingId(t.id);
    setEditBpm(t.bpm ? String(t.bpm) : '');
    setEditKey(t.key || '');
    setAnalysingId(null);
  }
  function saveEdit(id: string) {
    const bpm = parseInt(editBpm) || null;
    const key = editKey.trim().toUpperCase() || null;
    const bpmSource = bpm ? 'manual' as const : null;
    const keySource = key ? 'manual' as const : null;
    const update = (t: Track) => t.id === id ? { ...t, bpm: bpm ?? t.bpm, key: key ?? t.key, bpmSource: bpm ? 'manual' as const : t.bpmSource, keySource: key ? 'manual' as const : t.keySource } : t;
    setReleases(prev => prev.map(r => ({ ...r, tracks: r.tracks.map(update) })));
    setDjSet(prev => prev.map(update));
    setEditingId(null);
    saveTrackOverride({ id, bpm, key, bpmSource, keySource });
    setSavedCount(n => n + 1);
  }


  function exportToExcel() {
    // Dynamically load SheetJS
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX = (window as any).XLSX;

      const roleLabel = (t: Track) => roleOf(t).label;
      const source = (s: string | null) => s === 'enriched' ? 'auto' : s === 'manual' ? 'manual' : s === 'guessed' ? 'estimated' : '';

      // Sheet 1 — Full collection (one row per track)
      const collectionRows = allTracks(releases).map(t => ({
        Artist:      t.trackArtist || t.releaseArtist,
        Release:     t.releaseTitle,
        Track:       t.title,
        Position:    t.pos,
        Year:        t.year || '',
        Genre:       (t.genres || []).join(', '),
        Style:       (t.styles || []).join(', '),
        Role:        roleLabel(t),
        BPM:         t.bpm ?? '',
        'BPM Source': source(t.bpmSource),
        Key:         t.key ?? '',
        'Key Source': source(t.keySource),
        Duration:    t.duration || '',
      }));

      // Sheet 2 — DJ Set (ordered, with transition info)
      const setRows = djSet.map((t, i) => {
        const prev = djSet[i - 1];
        const compat = prev ? camCompat(prev.key, t.key) : null;
        const drift  = prev ? pitchDrift(prev.bpm, t.bpm) : null;
        return {
          '#':          i + 1,
          Artist:       t.trackArtist || t.releaseArtist,
          Release:      t.releaseTitle,
          Track:        t.title,
          Position:     t.pos,
          Role:         roleLabel(t),
          BPM:          t.bpm ?? '',
          Key:          t.key ?? '',
          'Compatibility': compat ?? '',
          'Pitch Drift':   drift ? `${drift.sign}${drift.pct}%` : '',
        };
      });

      const wb = XLSX.utils.book_new();

      // Style header rows bold
      const makeSheet = (rows: object[]) => {
        const ws = XLSX.utils.json_to_sheet(rows);
        // Set column widths
        ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 14) }));
        return ws;
      };

      if (collectionRows.length > 0) XLSX.utils.book_append_sheet(wb, makeSheet(collectionRows), 'Collection');
      if (setRows.length > 0)        XLSX.utils.book_append_sheet(wb, makeSheet(setRows), 'DJ Set');

      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `vinylflow-${date}.xlsx`);
    };
    document.head.appendChild(script);
  }

  function autoSuggest() { const pool=filteredTracks.length>0?filteredTracks:allTracks(releases); setDjSet(engine1BuildSet(pool,20)); setTab('set'); }
  function smartSort() { if (djSet.length>1) setDjSet(engine2SortSet(djSet)); }
  function toggleFilter<F>(setter: React.Dispatch<React.SetStateAction<Set<F>>>, val: F) {
    setter(prev => { const s=new Set(prev); s.has(val)?s.delete(val):s.add(val); return s; }); setPage(1);
  }

  const activePills = [
    ...Array.from(roleFilters).map(id => ({ label: `${ROLES[id]?.emoji} ${ROLES[id]?.label}`, color: ROLES[id]?.color||T.accent })),
    ...Array.from(genreFilters).map(g => ({ label: g, color: T.accent })),
    ...Array.from(decadeFilters).map(d => ({ label: d, color: '#555' })),
  ];

  const enrichedCount = allTracks(releases).filter(t => t.bpmSource === 'enriched').length;
  const totalTrackCount = allTracks(releases).length;

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:T.bg, fontFamily:"var(--font-geist-sans), system-ui, sans-serif", transition:'background 0.2s, color 0.2s' }}>
      {/* Global styles */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { color: ${T.text}; background: ${T.bg}; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${T.muted}; }
        input, button, select, textarea { font-family: inherit; }
        a { text-decoration: none; color: inherit; }
        button { cursor: pointer; }
        button:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
        ::selection { background: ${T.accent}22; }
      `}</style>

      {/* Header */}
      <header style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, height:54, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 1.5rem', flexShrink:0, boxShadow:T.shadow }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:'0.95rem', fontWeight:600, color:T.text, letterSpacing:'-0.04em' }}>vinyl<span style={{color:T.muted}}>.flow</span></span>
          {releases.length > 0 && <span style={{ width:1, height:16, background:T.border, margin:'0 6px', flexShrink:0 }} />}
          {(['library','set','analysis','stickers'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'0 10px', height:28, borderRadius:6, fontSize:'0.72rem', fontWeight:500, cursor:'pointer', border:'none', letterSpacing:'-0.01em', background: tab===t ? T.surface3 : 'transparent', color: tab===t ? T.text : T.muted, transition:'all 0.15s' }}>
              {t==='library'?`Library (${filteredTracks.length})`:t==='set'?`Set (${djSet.length})`:t==='analysis'?'Analysis':<span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>{Icon.label} Stickers</span>}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {savedCount > 0 && (
            <span title="BPM/key data saved locally — survives page refresh" style={{ fontSize:'0.65rem', color: T.greenAlt, display:'inline-flex', alignItems:'center', gap:4, fontWeight:500 }}>
              {Icon.save} {savedCount} saved
            </span>
          )}
          {releases.length > 0 && (
            <button onClick={exportToExcel} style={{ ...btn(), display:'inline-flex', alignItems:'center', gap:5 }} title="Export collection and set to Excel">{Icon.download} Export</button>
          )}
          {releases.length > 0 && !enriching && (
            <button onClick={expandTracklists} style={{ ...btn(), fontSize:'0.7rem', color: enrichedCount > 0 ? T.muted : T.text }}>
              {enrichedCount > 0 ? <>{Icon.save} {enrichedCount}/{totalTrackCount} enriched</> : <>{Icon.bolt} Enrich BPM/Key</>}
            </button>
          )}
          {enriching && (
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:'0.7rem', color:T.muted }}>
              <div style={{ width:90, height:3, background:T.surface3, borderRadius:2 }}>
                <div style={{ width:`${enrichProgress}%`, height:'100%', background:T.accent, borderRadius:2, transition:'width 0.3s' }} />
              </div>
              {enrichProgress}%
            </div>
          )}
          {user.avatar_url && <img src={user.avatar_url} alt="" style={{ width:22, height:22, borderRadius:'50%', border:`1px solid ${T.border}` }} />}
          <span style={{ fontSize:'0.72rem', fontWeight:500, color:T.muted, letterSpacing:'-0.01em' }}>{user.username}</span>
          <button onClick={toggleTheme} title={themeKey === 'light' ? 'Dark mode' : 'Light mode'} style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:32, height:32, background:'transparent', border:`1px solid ${T.border}`, borderRadius:6, cursor:'pointer', color:T.muted, transition:'all 0.15s' }}>
            {themeKey === 'light' ? Icon.moon : Icon.sun}
          </button>
          <a href="/api/auth/logout" style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:'0.72rem', color:T.muted, fontWeight:500, letterSpacing:'-0.01em', padding:'0 4px' }}>{Icon.logout} Log out</a>
        </div>
      </header>

      <main style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {error && <div style={{ background:'#fff5f5', borderBottom:`1px solid #c0392b`, padding:'0.5rem 1rem', fontSize:'0.75rem', color:'#c0392b' }}>⚠ {error}</div>}
        {enrichMsg && <div style={{ background:T.surface2, borderBottom:`1px solid ${T.border}`, padding:'0.4rem 1rem', fontSize:'0.7rem', color:T.muted }}>{enrichMsg}</div>}

        {!loading && releases.length === 0 && (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding:'2.5rem', maxWidth:420, textAlign:'center', boxShadow:T.shadowMd }}>
              <div style={{ fontSize:'2rem', marginBottom:'0.75rem' }}>🎛</div>
              <h2 style={{ fontSize:'1rem', fontWeight:700, marginBottom:'0.5rem' }}>Load your collection</h2>
              <p style={{ fontSize:'0.75rem', color:T.muted, lineHeight:1.7, marginBottom:'1.2rem' }}>Fetch all releases from Discogs and start building harmonic sets.</p>
              <button onClick={loadCollection} style={btn('primary')}>Load Collection</button>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, color:T.muted, fontSize:'0.8rem' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:T.accent, display:'inline-block' }} />
            {loadMsg}
          </div>
        )}

        {/* Library */}
        {!loading && releases.length > 0 && tab === 'library' && (
          <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding:'0 1.5rem', height:44, display:'flex', alignItems:'center', gap:8, flexShrink:0, flexWrap:'nowrap', overflowX:'auto' }}>
              <button onClick={() => setFilterOpen(o => !o)} style={{ ...btn('ghost'), display:'inline-flex', alignItems:'center', gap:5, color:T.muted }}>{Icon.filter} Filters</button>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', flex:1 }}>
                {activePills.slice(0,5).map((p,i) => <span key={i} style={{ ...chip(true,p.color), fontSize:'0.65rem', padding:'2px 7px' }}>{p.label}</span>)}
                {activePills.length===0 && <span style={{ fontSize:'0.65rem', color:T.muted, fontStyle:'italic' }}>no filters</span>}
              </div>
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search tracks..." style={{ padding:'5px 12px', borderRadius:8, border:`1px solid ${T.border}`, fontSize:'0.75rem', width:190, outline:'none', background:T.surface2, color:T.text, transition:'border 0.15s' }} />
              <button onClick={autoSuggest} style={{ ...btn('primary'), display:'inline-flex', alignItems:'center', gap:5 }}>{Icon.bolt} Auto-Suggest</button>
            </div>

            {filterOpen && (
              <div style={{ background:T.surface2, borderBottom:`1px solid ${T.border}`, padding:'0.5rem 1.5rem', display:'flex', gap:'1rem', flexWrap:'wrap', flexShrink:0 }}>
                <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'0.6rem', color:T.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Role</span>
                  <button onClick={() => setRoleFilters(new Set())} style={chip(roleFilters.size===0, T.accent)}>All</button>
                  {ROLE_IDS.map(id => <button key={id} onClick={() => toggleFilter(setRoleFilters, id)} style={chip(roleFilters.has(id), ROLES[id].color)}>{ROLES[id].emoji} {ROLES[id].label}</button>)}
                </div>
                {allGenres.length > 0 && (
                  <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'0.6rem', color:T.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Genre</span>
                    <button onClick={() => setGenreFilters(new Set())} style={chip(genreFilters.size===0, T.accent)}>All</button>
                    {allGenres.slice(0,14).map(g => <button key={g} onClick={() => toggleFilter(setGenreFilters, g)} style={chip(genreFilters.has(g), T.accent)}>{g}</button>)}
                  </div>
                )}
                {allDecades.length > 0 && (
                  <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'0.6rem', color:T.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Decade</span>
                    <button onClick={() => setDecadeFilters(new Set())} style={chip(decadeFilters.size===0, '#555')}>All</button>
                    {allDecades.map(d => <button key={d} onClick={() => toggleFilter(setDecadeFilters, d)} style={chip(decadeFilters.has(d), '#555')}>{d}</button>)}
                  </div>
                )}
              </div>
            )}

            <div style={{ flex:1, overflowY:'auto', padding:'0.5rem 1rem' }}>
              {pagedTracks.length === 0
                ? <div style={{ padding:'2rem', textAlign:'center', color:T.muted, fontSize:'0.8rem' }}>No tracks match your filters.</div>
                : pagedTracks.map(t => {
                    const role = roleOf(t); const added = inSet(t.id);
                    return (
                      <div key={t.id} style={{ marginBottom:3 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px 8px 0', borderRadius: analysingId === t.id ? '10px 10px 0 0' : 10, background:T.surface, border:`1px solid ${T.border}`, borderLeft:`3px solid ${role.color}`, borderBottom: analysingId === t.id ? 'none' : `1px solid ${T.border}`, boxShadow: T.shadow, transition:'box-shadow 0.15s', overflow:'hidden' }}>
                          {t.thumb
                            ? <img src={t.thumb} alt="" style={{ width:36, height:36, objectFit:'cover', flexShrink:0, marginLeft:10 }} />
                            : <div style={{ width:36, height:36, background:T.surface2, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', flexShrink:0, marginLeft:10 }}>{visualCue(t.releaseId)}</div>
                          }
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:'0.78rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:T.text }}>{t.title}</div>
                            <div style={{ fontSize:'0.63rem', color:T.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:1 }}>{t.trackArtist || t.releaseArtist} · <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:'0.6rem' }}>{t.pos}</span>{t.year ? ` · ${t.year}` : ''}</div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                            {t.key && <span style={{ fontSize:'0.68rem', fontWeight:700, color: t.keySource==='enriched'||t.keySource==='manual' ? T.djAmber : T.muted, fontFamily:"var(--font-geist-mono), monospace", background: t.keySource==='enriched'||t.keySource==='manual' ? `${T.djAmber}18` : 'transparent', padding:'2px 6px', borderRadius:4, letterSpacing:'0.02em' }}>{t.key}</span>}
                            {t.bpm && <span style={{ fontSize:'0.72rem', fontWeight:600, color: t.bpmSource==='enriched'||t.bpmSource==='manual' ? T.djAmber : T.muted, fontFamily:"var(--font-geist-mono), monospace", minWidth:28, textAlign:'right', letterSpacing:'0.02em' }}>{t.bpm}</span>}
                            <button onClick={() => setAnalysingId(analysingId === t.id ? null : t.id)} title="Analyse audio" style={{ ...btn('ghost'), padding:'0 6px', height:28, color: t.bpmSource==='enriched' ? T.greenAlt : T.muted }}>{Icon.music}</button>
                            <button onClick={() => editingId === t.id ? setEditingId(null) : openEdit(t)} title="Edit manually" style={{ ...btn('ghost'), padding:'0 6px', height:28, color: t.bpmSource==='manual'||t.keySource==='manual' ? T.djAmber : T.muted }}>{Icon.edit}</button>
                            <button onClick={() => added?removeFromSet(t.id):addToSet(t)} style={{ padding:'4px 10px', borderRadius:7, fontSize:'0.7rem', fontWeight:700, cursor:'pointer', border:'none', background:added?T.surface3:T.accent, color:added?T.muted:T.accentFg, transition:'all 0.15s', letterSpacing:'0.02em' }}>{added ? Icon.save : '+'}</button>
                          </div>
                        </div>
                        {analysingId === t.id && (
                          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderTop:'none', borderRadius:'0 0 7px 7px', padding:'6px 10px 8px' }}>
                            <EssentiaAnalyser
                              trackName={`${t.title} — ${t.trackArtist}`}
                              onResult={r => handleAnalysisResult(t.id, r.bpm, r.key)}
                            />
                          </div>
                        )}
                        {editingId === t.id && (
                          <div style={{ background:T.surface, border:`1px solid ${T.accent}`, borderTop:'none', borderRadius:'0 0 7px 7px', padding:'8px 12px', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <span style={{ fontSize:'0.65rem', color:T.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>Manual Override</span>
                            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                              <label style={{ fontSize:'0.65rem', color:T.muted }}>BPM</label>
                              <input type="number" value={editBpm} onChange={e => setEditBpm(e.target.value)} placeholder="120" min={40} max={220} style={{ width:60, padding:'3px 6px', borderRadius:5, border:`1px solid ${T.border}`, fontSize:'0.75rem', textAlign:'center' }} />
                            </div>
                            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                              <label style={{ fontSize:'0.65rem', color:T.muted }}>Key</label>
                              <select value={editKey} onChange={e => setEditKey(e.target.value)} style={{ padding:'3px 6px', borderRadius:5, border:`1px solid ${T.border}`, fontSize:'0.75rem' }}>
                                <option value="">—</option>
                                {['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B','7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B'].map(k => <option key={k} value={k}>{k}</option>)}
                              </select>
                            </div>
                            <button onClick={() => saveEdit(t.id)} style={{ ...btn('primary'), padding:'3px 10px', fontSize:'0.72rem' }}>Save</button>
                            <button onClick={() => setEditingId(null)} style={{ ...btn(), padding:'3px 8px', fontSize:'0.72rem' }}>Cancel</button>
                          </div>
                        )}
                      </div>
                    );
                  })
              }
            </div>

            {totalPages > 1 && (
              <div style={{ borderTop:`1px solid ${T.border}`, padding:'0.5rem 1rem', display:'flex', alignItems:'center', justifyContent:'center', gap:8, flexShrink:0 }}>
                <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} style={btn()}>{Icon.chevronL}</button>
                <span style={{ fontSize:'0.75rem', color:T.muted }}>{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} style={btn()}>{Icon.chevronR}</button>
              </div>
            )}
          </div>
        )}

        {/* Set */}
        {!loading && releases.length > 0 && tab === 'set' && (
          <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding:'0.5rem 1rem', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <span style={{ fontSize:'0.75rem', fontWeight:600, flex:1 }}>{djSet.length} tracks</span>
              <button onClick={smartSort} disabled={djSet.length<2} style={btn()}>🔀 Smart Sort</button>
              <button onClick={() => setDjSet([])} style={{ ...btn(), color:'#c0392b' }}>Clear</button>
            </div>
            {djSet.length === 0
              ? <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:T.muted, fontSize:'0.8rem', flexDirection:'column', gap:8 }}>
                  <div style={{ color:T.muted, marginBottom:8 }}>{Icon.music}</div>No tracks yet — go to Library and add some
                </div>
              : <div style={{ flex:1, overflowY:'auto', padding:'0.5rem 1rem' }}>
                  {djSet.map((t,i) => {
                    const role=roleOf(t); const prev=djSet[i-1];
                    const compat=prev?camCompat(prev.key,t.key):null;
                    const drift=prev?pitchDrift(prev.bpm,t.bpm):null;
                    const blocked=prev?sameSide(prev,t):false;
                    return (
                      <div key={t.id}>
                        {i > 0 && (
                          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 36px', marginBottom:2 }}>
                            <div style={{ width:1, height:10, background:T.border }} />
                            {blocked && <span style={{ fontSize:'0.65rem', color:'#c0392b', fontWeight:700 }}>🛑 same side</span>}
                            {compat && !blocked && <span style={{ fontSize:'0.65rem', fontWeight:700, color:compatColor(compat) }}>{compat}</span>}
                            {drift && <span style={{ fontSize:'0.65rem', color:drift.high?'#c0392b':T.muted }}>{drift.high?'⚡ ':''}{drift.sign}{drift.pct}%</span>}
                          </div>
                        )}
                        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderRadius:9, marginBottom:3, background:T.surface, border:`1px solid ${T.border}`, boxShadow:T.shadow }}>
                          <span style={{ fontSize:'0.65rem', color:T.muted, width:18, textAlign:'center', flexShrink:0 }}>{i+1}</span>
                          <div style={{ width:8, height:8, borderRadius:'50%', background:role.color, flexShrink:0 }} />
                          {t.thumb ? <img src={t.thumb} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover', flexShrink:0 }} /> : <div style={{ width:28, height:28, borderRadius:4, background:T.surface2, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.9rem', flexShrink:0 }}>{visualCue(t.releaseId)}</div>}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:'0.78rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</div>
                            <div style={{ fontSize:'0.65rem', color:T.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.trackArtist} · {t.pos}</div>
                          </div>
                          {t.key && <span style={{ fontSize:'0.65rem', fontWeight:700, color: t.keySource==='enriched'||t.keySource==='manual' ? T.djAmber : T.muted }}>{t.key}</span>}
                          {t.bpm && <span style={{ fontSize:'0.65rem', color: t.bpmSource==='enriched'||t.bpmSource==='manual' ? T.djAmber : T.muted }}>{t.bpm}</span>}
                          <div style={{ display:'flex', gap:2 }}>
                            <button onClick={() => moveUp(i)} disabled={i===0} style={{ ...btn('ghost'), padding:'2px 5px', fontSize:'0.7rem' }}>↑</button>
                            <button onClick={() => moveDown(i)} disabled={i===djSet.length-1} style={{ ...btn('ghost'), padding:'2px 5px', fontSize:'0.7rem' }}>↓</button>
                            <button onClick={() => removeFromSet(t.id)} style={{ ...btn('ghost'), padding:'2px 5px', fontSize:'0.7rem', color:'#c0392b' }}>✕</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}

        {/* Analysis */}
        {!loading && releases.length > 0 && tab === 'analysis' && (
          <div style={{ flex:1, overflowY:'auto', padding:'1rem' }}>
            {djSet.length === 0
              ? <div style={{ color:T.muted, fontSize:'0.8rem' }}>Build a set first to see analysis.</div>
              : <div style={{ display:'flex', flexDirection:'column', gap:'1rem', maxWidth:640 }}>
                  <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:'1.1rem', boxShadow:T.shadow }}>
                    <h3 style={{ fontSize:'0.75rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.muted, marginBottom:'0.75rem' }}>Role Breakdown</h3>
                    {ROLE_IDS.map(id => {
                      const count=djSet.filter(t=>assignRole(t)===id).length; if(!count) return null;
                      const pct=Math.round(count/djSet.length*100);
                      return <div key={id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                        <span style={{ fontSize:'0.7rem', width:80 }}>{ROLES[id].emoji} {ROLES[id].label}</span>
                        <div style={{ flex:1, height:6, background:T.border, borderRadius:3, overflow:'hidden' }}><div style={{ width:`${pct}%`, height:'100%', background:ROLES[id].color, borderRadius:3 }} /></div>
                        <span style={{ fontSize:'0.65rem', color:T.muted, width:40, textAlign:'right' }}>{count} ({pct}%)</span>
                      </div>;
                    })}
                  </div>
                  <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:'1.1rem', boxShadow:T.shadow }}>
                    <h3 style={{ fontSize:'0.75rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.muted, marginBottom:'0.75rem' }}>Flow Notes</h3>
                    {setSuggestions(djSet).map((s,i) => <div key={i} style={{ display:'flex', gap:6, marginBottom:5, fontSize:'0.75rem' }}><span>{s.type==='warning'?'⚠':'ℹ'}</span><span style={{ color:s.type==='warning'?'#c0392b':T.text }}>{s.message}</span></div>)}
                  </div>
                  <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:'1.1rem', boxShadow:T.shadow }}>
                    <h3 style={{ fontSize:'0.75rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.muted, marginBottom:'0.75rem' }}>Transitions</h3>
                    {djSet.slice(0,-1).map((t,i) => {
                      const next=djSet[i+1]; const compat=camCompat(t.key,next.key); const drift=pitchDrift(t.bpm,next.bpm); const bridge=bpmBridge(t.bpm,next.bpm);
                      return <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4, fontSize:'0.7rem' }}>
                        <span style={{ color:T.subtle, fontSize:'0.65rem', width:20, fontVariantNumeric:'tabular-nums' }}>{i+1}</span>
                        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</span>
                        {compat && <span style={{ fontWeight:700, color:compatColor(compat), flexShrink:0 }}>{compat}</span>}
                        {bridge && <span style={{ color:bridge.ok?T.greenAlt:T.red, flexShrink:0 }}>{bridge.l}</span>}
                        {drift && <span style={{ color:drift.high?'#c0392b':T.muted, flexShrink:0 }}>{drift.sign}{drift.pct}%</span>}
                      </div>;
                    })}
                  </div>
                </div>
            }
          </div>
        )}
        {/* ── Stickers Tab ───────────────────────────────────────────── */}
        {!loading && releases.length > 0 && tab === 'stickers' && (
          <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column' }}>

            <div className="no-print" style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding:'0 1.5rem', height:48, display:'flex', alignItems:'center', gap:10, flexShrink:0, flexWrap:'wrap' }}>
              <span style={{ fontSize:'0.7rem', fontWeight:700, color:T.muted, textTransform:'uppercase', letterSpacing:'0.07em' }}>Source</span>
              <button onClick={() => setStickerSource('collection')} style={chip(stickerSource==='collection', T.accent)}>Full Collection ({releases.length})</button>
              <button onClick={() => setStickerSource('set')} style={chip(stickerSource==='set', T.accent)}>Current Set ({djSet.length})</button>
              <div style={{ flex:1 }} />
              <span style={{ fontSize:'0.65rem', color:T.muted }}>Avery L7651 / 65-up</span>
              <button onClick={() => window.print()} style={{ ...btn('primary'), display:'inline-flex', alignItems:'center', gap:6 }}>{Icon.print} Print</button>
            </div>

            <div className="no-print" style={{ background:T.surface2, borderBottom:`1px solid ${T.border}`, padding:'0.4rem 1rem', display:'flex', gap:12, flexWrap:'wrap', flexShrink:0 }}>
              {ROLE_IDS.map(id => (
                <span key={id} style={{ display:'flex', alignItems:'center', gap:5, fontSize:'0.65rem' }}>
                  <span style={{ width:10, height:10, borderRadius:2, background:ROLES[id].color, display:'inline-block' }} />
                  {ROLES[id].label}
                </span>
              ))}
              <span style={{ fontSize:'0.65rem', color:T.muted }}>Grey BPM/key = estimated &nbsp;·&nbsp; Coloured = verified</span>
            </div>

            <div id="sticker-print-area" style={{ padding:'1rem', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:'6px' }}>
              {(stickerSource === 'set' ? djSet : allTracks(releases)
                .filter((t, i, arr) => arr.findIndex(x => x.releaseId === t.releaseId) === i)
              ).map(t => {
                const role = roleOf(t);
                const bpmVerified = t.bpmSource === 'enriched' || t.bpmSource === 'manual';
                const keyVerified = t.keySource === 'enriched' || t.keySource === 'manual';
                return (
                  <div key={t.id} style={{ border:`2px solid ${role.color}`, borderRadius:8, padding:'7px 9px', background: themeKey === 'dark' ? T.surface : '#fff', display:'flex', flexDirection:'column', gap:2, pageBreakInside:'avoid', minHeight:78, boxShadow:T.shadow }}>
                    <div style={{ height:3, borderRadius:2, background:role.color, marginBottom:2 }} />
                    <div style={{ fontSize:'0.55rem', color:'#999', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {t.releaseArtist}
                    </div>
                    <div style={{ fontSize:'0.62rem', fontWeight:700, lineHeight:1.25, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2 as unknown as number, WebkitBoxOrient:'vertical' as const }}>
                      {t.releaseTitle}
                    </div>
                    <div style={{ marginTop:'auto', display:'flex', alignItems:'baseline', justifyContent:'space-between', paddingTop:4, borderTop:`1px solid ${T.border}` }}>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start' }}>
                        <span style={{ fontSize:'0.45rem', color:T.muted, textTransform:'uppercase', letterSpacing:'0.05em' }}>BPM</span>
                        <span style={{ fontSize:t.bpm?'1.05rem':'0.7rem', fontWeight:900, color:bpmVerified?role.color:'#ccc', lineHeight:1 }}>
                          {t.bpm ?? '—'}
                        </span>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end' }}>
                        <span style={{ fontSize:'0.45rem', color:T.muted, textTransform:'uppercase', letterSpacing:'0.05em' }}>KEY</span>
                        <span style={{ fontSize:t.key?'0.9rem':'0.7rem', fontWeight:900, color:keyVerified?role.color:'#ccc', lineHeight:1 }}>
                          {t.key ?? '—'}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize:'0.48rem', color:role.color, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginTop:2 }}>
                      {role.emoji} {role.label}
                    </div>
                  </div>
                );
              })}
            </div>

            <style>{`
              @media print {
                .no-print { display: none !important; }
                body, html { margin: 0; background: white; }
                #sticker-print-area {
                  padding: 8mm !important;
                  grid-template-columns: repeat(5, 1fr) !important;
                  gap: 3px !important;
                }
              }
            `}</style>
          </div>
        )}

      </main>
    </div>
  );
}
