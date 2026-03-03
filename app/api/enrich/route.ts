/**
 * POST /api/enrich
 * Body: { artist: string, title: string }
 * Returns: { bpm: number | null, key: string | null, source: string }
 *
 * Sources tried in order:
 *  1. GetSongBPM (free API, good electronic music coverage)
 *  2. MusicBrainz (fallback, slower, lower hit rate for electronic)
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const UA = 'vinylflow/1.0 (https://vinylflow.vercel.app)';

// ── Key normalisation to Camelot ──────────────────────────────────────────
const KEY_MAP: Record<string, string> = {
  'Abm': '1A', 'G#m': '1A', 'B': '1B',
  'Ebm': '2A', 'D#m': '2A', 'F#': '2B', 'Gb': '2B',
  'Bbm': '3A', 'A#m': '3A', 'Db': '3B', 'C#': '3B',
  'Fm': '4A',  'Ab': '4B', 'G#': '4B',
  'Cm': '5A',  'Eb': '5B', 'D#': '5B',
  'Gm': '6A',  'Bb': '6B', 'A#': '6B',
  'Dm': '7A',  'F': '7B',
  'Am': '8A',  'C': '8B',
  'Em': '9A',  'G': '9B',
  'Bm': '10A', 'D': '10B',
  'F#m': '11A','Gbm': '11A', 'A': '11B',
  'C#m': '12A','Dbm': '12A', 'E': '12B',
  // open_key format (GetSongBPM uses this)
  '1m': '1A', '1d': '1B',
  '2m': '2A', '2d': '2B',
  '3m': '3A', '3d': '3B',
  '4m': '4A', '4d': '4B',
  '5m': '5A', '5d': '5B',
  '6m': '6A', '6d': '6B',
  '7m': '7A', '7d': '7B',
  '8m': '8A', '8d': '8B',
  '9m': '9A', '9d': '9B',
  '10m': '10A', '10d': '10B',
  '11m': '11A', '11d': '11B',
  '12m': '12A', '12d': '12B',
};

const CAM_KEYS = ['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
                  '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B'];

function normKey(raw: string): string | null {
  if (!raw) return null;
  const c = raw.trim();
  if (CAM_KEYS.includes(c.toUpperCase())) return c.toUpperCase();
  // Direct map
  if (KEY_MAP[c]) return KEY_MAP[c];
  // Standard format: "C major" → "C", "A minor" → "Am"
  const m = c.match(/^([A-Ga-g][#b]?)\s*(major|minor|maj|min)?$/i);
  if (m) {
    const note = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const qual = (m[2] || '').toLowerCase();
    const k = qual.startsWith('min') ? note + 'm' : note;
    if (KEY_MAP[k]) return KEY_MAP[k];
  }
  return null;
}

// ── Source 1: GetSongBPM ──────────────────────────────────────────────────
async function tryGetSongBPM(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  const apiKey = process.env.GETSONGBPM_API_KEY;
  if (!apiKey) return null;

  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const url = `https://api.getsong.co/search/?api_key=${apiKey}&type=song&lookup=${q}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const songs = data.search || [];
    if (songs.length === 0) return null;

    // Find best match — prefer exact title match
    const titleLow = title.toLowerCase();
    const artistLow = artist.toLowerCase();
    let best = songs[0];
    for (const s of songs) {
      const sTitle = (s.title || '').toLowerCase();
      const sArtist = (s.artist?.name || '').toLowerCase();
      if (sTitle.includes(titleLow) && sArtist.includes(artistLow.split(' ')[0])) {
        best = s;
        break;
      }
    }

    const bpm = best.tempo ? parseInt(best.tempo) : null;
    const key = best.open_key ? normKey(best.open_key) : (best.key_of ? normKey(best.key_of) : null);
    if (!bpm && !key) return null;
    return { bpm, key };
  } catch { return null; }
}

// ── Source 2: MusicBrainz (fallback) ─────────────────────────────────────
async function tryMusicBrainz(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  try {
    const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${q}&limit=3&fmt=json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const recs = data.recordings || [];
    if (recs.length === 0) return null;
    // MusicBrainz alone doesn't give BPM/key but confirms track exists
    // Return null — we only use it as last resort if we add AcousticBrainz later
    return null;
  } catch { return null; }
}

// ── Handler ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { artist, title } = await req.json();
    if (!artist || !title) {
      return NextResponse.json({ error: 'artist and title required' }, { status: 400 });
    }

    const gsbpm = await tryGetSongBPM(artist, title);
    if (gsbpm?.bpm || gsbpm?.key) {
      return NextResponse.json({ bpm: gsbpm.bpm, key: gsbpm.key, source: 'getsongbpm' });
    }

    // Could add more sources here in future
    return NextResponse.json({ bpm: null, key: null, source: 'none' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
