/**
 * beatport.ts — Beatport API v4 integration
 *
 * Auth: Bearer token stored in BEATPORT_ACCESS_TOKEN env var.
 * Auto-refreshes using BEATPORT_REFRESH_TOKEN when expired.
 *
 * Endpoints used:
 *   GET /v4/catalog/tracks/?search={artist+title}&page=1&per_page=5
 *   Returns: bpm, key (standard notation e.g. "Ab min") → converted to Camelot
 */

const BASE = 'https://api.beatport.com/v4';

// ── Key conversion: Beatport standard → Camelot ──────────────────────────────
const KEY_TO_CAMELOT: Record<string, string> = {
  'G# min': '1A',  'Ab min': '1A',
  'B maj':  '1B',
  'Eb min': '2A',  'D# min': '2A',
  'F# maj': '2B',  'Gb maj': '2B',
  'Bb min': '3A',  'A# min': '3A',
  'Db maj': '3B',  'C# maj': '3B',
  'F min':  '4A',
  'Ab maj': '4B',  'G# maj': '4B',
  'C min':  '5A',
  'Eb maj': '5B',  'D# maj': '5B',
  'G min':  '6A',
  'Bb maj': '6B',  'A# maj': '6B',
  'D min':  '7A',
  'F maj':  '7B',
  'A min':  '8A',
  'C maj':  '8B',
  'E min':  '9A',
  'G maj':  '9B',
  'B min':  '10A',
  'D maj':  '10B',
  'F# min': '11A', 'Gb min': '11A',
  'A maj':  '11B',
  'C# min': '12A', 'Db min': '12A',
  'E maj':  '12B',
};

function toCamelot(beatportKey: string): string | null {
  if (!beatportKey) return null;
  // Beatport returns e.g. "Ab min", "C maj", "F# min"
  // Normalize unicode flats/sharps
  const normalized = beatportKey
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return KEY_TO_CAMELOT[normalized] ?? null;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  // Try env var first (set in Vercel)
  const token = process.env.BEATPORT_ACCESS_TOKEN;
  if (token) return token;
  return null;
}

async function refreshToken(): Promise<string | null> {
  const refreshToken = process.env.BEATPORT_REFRESH_TOKEN;
  if (!refreshToken) return null;

  // Scrape client_id from Beatport docs page
  let clientId = 'GN2ZBxLlxZ5KJBMtl4O4J7Q7wy2aNVvX'; // known public client_id
  try {
    const docsRes = await fetch('https://api.beatport.com/v4/docs/', {
      signal: AbortSignal.timeout(5000),
    });
    if (docsRes.ok) {
      const html = await docsRes.text();
      const m = html.match(/clientId['":\s]+['"]([a-zA-Z0-9_-]{20,})['"]/);
      if (m) clientId = m[1];
    }
  } catch { /* use default */ }

  try {
    const res = await fetch(`${BASE}/auth/o/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch { return null; }
}

// ── API call ──────────────────────────────────────────────────────────────────

async function beatportFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 401) {
    // Token expired — try refresh
    const newToken = await refreshToken();
    if (!newToken) throw new Error('Token refresh failed');
    const retry = await fetch(`${BASE}${path}`, {
      headers: { 'Authorization': `Bearer ${newToken}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!retry.ok) throw new Error(`Beatport API error: ${retry.status}`);
    return await retry.json();
  }

  if (!res.ok) throw new Error(`Beatport API error: ${res.status}`);
  return await res.json();
}

// ── Track match scoring ───────────────────────────────────────────────────────

function matchScore(track: BeatportTrack, artist: string, title: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const artistNorm = normalize(artist);
  const titleNorm  = normalize(title);
  const trackArtists = (track.artists || []).map((a: { name: string }) => normalize(a.name)).join('');
  const trackTitle   = normalize(track.name || '');

  let score = 0;
  if (trackTitle.includes(titleNorm) || titleNorm.includes(trackTitle)) score += 3;
  if (trackArtists.includes(artistNorm)) score += 2;
  // Exact BPM match bonus handled by caller
  return score;
}

interface BeatportTrack {
  id: number;
  name: string;
  bpm: number | null;
  key: { camelot_name?: string; name?: string } | null;
  artists: { name: string }[];
  release: { name: string; catalog_number?: string };
  preview: { mp3: { preview_url: string } | null } | null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BeatportResult {
  bpm:      number | null;
  key:      string | null; // Camelot
  audioUrl: string | null;
  found:    boolean;
}

export async function lookupBeatport(
  artist: string,
  title: string,
  catno?: string,
): Promise<BeatportResult> {
  const empty: BeatportResult = { bpm: null, key: null, audioUrl: null, found: false };

  const token = await getToken();
  if (!token) return empty;

  try {
    // Search by catalog number first if available (most precise)
    const queries = catno
      ? [`/catalog/tracks/?search=${encodeURIComponent(catno)}&per_page=5`,
         `/catalog/tracks/?search=${encodeURIComponent(`${artist} ${title}`)}&per_page=10`]
      : [`/catalog/tracks/?search=${encodeURIComponent(`${artist} ${title}`)}&per_page=10`];

    for (const query of queries) {
      const data = await beatportFetch(query, token) as { results?: BeatportTrack[] };
      const tracks = data?.results ?? [];
      if (tracks.length === 0) continue;

      // Score and rank results
      const scored = tracks
        .map(t => ({ track: t, score: matchScore(t, artist, title) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (best.score === 0) continue; // no match

      const t = best.track;
      const bpm = t.bpm ?? null;

      // Key: Beatport v4 returns camelot_name directly or standard name
      let key: string | null = null;
      if (t.key?.camelot_name) {
        key = t.key.camelot_name; // already in Camelot e.g. "11A"
      } else if (t.key?.name) {
        key = toCamelot(t.key.name);
      }

      const audioUrl = t.preview?.mp3?.preview_url ?? null;

      if (bpm || key) {
        return { bpm, key, audioUrl, found: true };
      }
    }
  } catch (e) {
    console.error('[beatport]', e);
  }

  return empty;
}
