/**
 * clientEnrich.ts — Browser-side BPM/Key enrichment pipeline
 *
 * Ported directly from vinyl.flow v10 prototype.
 * Runs entirely in the user's browser — no server, no IP blocking.
 *
 * Pipeline (in order):
 *   1. Tunebat       → BPM + Camelot key (best source)
 *   2. Beatport HTML → BPM + key + genres/styles (__NEXT_DATA__)
 *   3. Juno Download → BPM + key + genres (HTML scrape)
 *   4. Last.fm       → genre/style tags
 *   5. MusicBrainz + AcousticBrainz → BPM + key (audio fingerprint DB)
 */

const CAM_KEYS = [
  '1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
  '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B',
];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Key normalisation ─────────────────────────────────────────────────────

function musicKeyToCamelot(keyStr: string, scaleStr: string): string | null {
  const noteMap: Record<string, string> = {
    'C':'8B','Db':'3B','D':'10B','Eb':'5B','E':'12B','F':'7B',
    'Gb':'2B','G':'9B','Ab':'4B','A':'11B','Bb':'6B','B':'1B',
    'C#':'3B','D#':'5B','F#':'2B','G#':'4B','A#':'6B',
  };
  const minorMap: Record<string, string> = {
    'C':'5A','Db':'12A','D':'7A','Eb':'2A','E':'9A','F':'4A',
    'Gb':'11A','G':'6A','Ab':'1A','A':'8A','Bb':'3A','B':'10A',
    'C#':'12A','D#':'2A','F#':'11A','G#':'1A','A#':'3A',
  };
  const k = (keyStr || '').trim();
  const isMinor = (scaleStr || '').toLowerCase().includes('minor')
    || k.toLowerCase().includes('minor')
    || k.endsWith('m');
  const note = k.replace(/\s*(minor|major|m)\s*/gi, '').trim();
  return isMinor ? (minorMap[note] ?? null) : (noteMap[note] ?? null);
}

export function normalizeCamelot(str: string | null | undefined): string | null {
  if (!str) return null;
  const s = String(str).trim().toUpperCase().replace(/\s+/g, '');
  if (CAM_KEYS.includes(s)) return s;
  const m = s.match(/^(\d{1,2})\s*([AB])$/);
  if (m) return m[1] + m[2];
  return musicKeyToCamelot(str, str.includes('m') || str.toLowerCase().includes('minor') ? 'minor' : 'major');
}

// ── Result type ───────────────────────────────────────────────────────────

export interface EnrichHit {
  bpm:    number | null;
  key:    string | null;
  genres: string[];
  styles: string[];
  source: string;
}

// ── Source 1: Tunebat ─────────────────────────────────────────────────────

async function tunebatSearch(query: string): Promise<EnrichHit | null> {
  try {
    const url = `https://tunebat.com/api/search?q=${encodeURIComponent(query)}&limit=1`;
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const hit = (j.data || j.results || j.items || [])[0];
    if (!hit) return null;
    const bpm = hit.bpm || hit.Bpm || hit.tempo || null;
    const key = normalizeCamelot(hit.camelot || hit.key || hit.Key || null);
    if (!bpm && !key) return null;
    return { bpm: bpm ? Math.round(bpm) : null, key, genres: [], styles: [], source: 'tunebat' };
  } catch { return null; }
}

// ── Source 2: Beatport HTML (__NEXT_DATA__) ───────────────────────────────

async function beatportSearch(artist: string, title: string): Promise<EnrichHit | null> {
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const url = `https://www.beatport.com/search/tracks?q=${q}`;
    const r = await fetch(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const tracks: unknown[] =
      (data?.props?.pageProps?.tracks) ||
      (data?.props?.pageProps?.data?.tracks?.data) ||
      (data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.results) || [];
    if (!tracks.length) return null;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const target = norm(title);
    const hit = (tracks as Record<string, unknown>[]).find(t => {
      const n = norm(String(t.name || t.title || ''));
      return n.includes(target) || target.includes(n);
    });
    if (!hit) return null;
    const bpm = (hit.bpm || hit.tempo) as number | null;
    const keyRaw = ((hit.key as Record<string, string>)?.camelot_name
      || (hit.key as Record<string, string>)?.name
      || hit.camelot_key) as string | null;
    const genres: string[] = hit.genre
      ? [(hit.genre as Record<string, string>).name]
      : ((hit.genres as {name:string}[]) || []).map(g => g.name);
    const styles: string[] = hit.subgenre
      ? [(hit.subgenre as Record<string, string>).name]
      : ((hit.sub_genres as {name:string}[]) || []).map(g => g.name);
    const key = normalizeCamelot(keyRaw);
    if (!bpm && !key) return null;
    return { bpm: bpm ? Math.round(bpm) : null, key, genres, styles, source: 'beatport' };
  } catch { return null; }
}

// ── Source 3: Juno Download ───────────────────────────────────────────────

async function junoSearch(artist: string, title: string, relTitle: string): Promise<EnrichHit | null> {
  try {
    const q = encodeURIComponent(`${artist} ${title || relTitle}`);
    const url = `https://www.juno.co.uk/search/?q%5Ball%5D%5B%5D=${q}&order=relevance&facets%5BformatDescriptions%5D%5B%5D=12%22+Vinyl`;
    const r = await fetch(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const html = await r.text();
    const bpmMatch = html.match(/class="bpm[^"]*"[^>]*>[\s\S]*?(\d{2,3}(?:\.\d)?)\s*BPM/i)
                  || html.match(/(\d{2,3})\s*bpm/i);
    const keyMatch = html.match(/camelot[^"]*"[^>]*>([\d]{1,2}[AB])/i)
                  || html.match(/>([\d]{1,2}[AB])<\/span>/);
    const genreMatches = [...html.matchAll(/class="[^"]*genre[^"]*"[^>]*>([^<]+)</gi)];
    const genres = [...new Set(genreMatches.map(m => m[1].trim()).filter(g => g.length > 2 && g.length < 30))].slice(0, 3);
    const bpm = bpmMatch ? parseFloat(bpmMatch[1]) : null;
    const key = keyMatch ? normalizeCamelot(keyMatch[1]) : null;
    if (!bpm && !key && !genres.length) return null;
    return { bpm, key, genres, styles: [], source: 'juno' };
  } catch { return null; }
}

// ── Source 4: Last.fm ─────────────────────────────────────────────────────

async function lastfmTrack(artist: string, title: string): Promise<EnrichHit | null> {
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&format=json&api_key=bc31b36b1ef34ad49c2b36571e67d08d`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.track) return null;
    const tags: string[] = (j.track.toptags?.tag || []).map((t: {name:string}) => t.name).filter((t: string) => t.length > 1 && t.length < 25);
    const genreMap: Record<string, string> = {
      'house':'House','deep house':'Deep House','tech house':'Tech House',
      'techno':'Techno','minimal techno':'Minimal Techno','detroit techno':'Detroit Techno',
      'ambient':'Ambient','drum and bass':'Drum n Bass','jungle':'Jungle',
      'disco':'Disco','funk':'Funk','soul':'Soul','jazz':'Jazz',
      'hip-hop':'Hip-Hop','hip hop':'Hip-Hop','trance':'Trance',
      'progressive house':'Progressive House','electro':'Electro','acid':'Acid',
      'dub techno':'Dub Techno','industrial':'Industrial','experimental':'Experimental',
      'garage':'Garage House','uk garage':'UK Garage','breakbeat':'Breakbeat',
    };
    const styles = tags.map(t => genreMap[t.toLowerCase()]).filter(Boolean) as string[];
    if (!styles.length) return null;
    return { bpm: null, key: null, genres: [], styles, source: 'lastfm' };
  } catch { return null; }
}

// ── Source 5: MusicBrainz + AcousticBrainz ───────────────────────────────

async function mbSearch(artist: string, title: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const url = `https://musicbrainz.org/ws/2/recording/?query=${q}&limit=1&fmt=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'VinylFlow/1.0 (https://vinylflow.vercel.app)' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.recordings || [])[0]?.id || null;
  } catch { return null; }
}

async function abGet(mbid: string): Promise<EnrichHit | null> {
  try {
    const url = `https://acousticbrainz.org/${mbid}/high-level?format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const bpm = j.rhythm?.bpm?.value || j.rhythm?.bpm || null;
    const keyStr = j.tonal?.chords_key?.value || j.tonal?.key_key?.value || null;
    const scaleStr = j.tonal?.chords_scale?.value || j.tonal?.key_scale?.value || null;
    if (!bpm && !keyStr) return null;
    const key = keyStr ? musicKeyToCamelot(keyStr, scaleStr || '') : null;
    return { bpm: bpm ? Math.round(bpm) : null, key, genres: [], styles: [], source: 'acousticbrainz' };
  } catch { return null; }
}

// ── Main export ───────────────────────────────────────────────────────────

export interface TrackInput {
  id:            string;
  trackArtist:   string;
  releaseArtist: string;
  title:         string;
  releaseTitle:  string;
  label?:        string;
  catno?:        string;
  bpmSource:     string | null;
  keySource:     string | null;
  genres:        string[];
  styles:        string[];
}

export interface EnrichResult {
  id:      string;
  bpm:     number | null;
  key:     string | null;
  genres:  string[];
  styles:  string[];
  source:  string;
}

export async function enrichTrackClient(track: TrackInput): Promise<EnrichResult | null> {
  if (track.bpmSource === 'enriched' && track.keySource === 'enriched') return null;

  const artist = (track.trackArtist || track.releaseArtist || '').trim();
  const title  = (track.title || '').trim();
  const relTitle = (track.releaseTitle || '').trim();

  let bpm:    number | null = null;
  let key:    string | null = null;
  let genres: string[]      = [];
  let styles: string[]      = [];
  let source = '';

  const needsBpm = track.bpmSource !== 'enriched';
  const needsKey = track.keySource !== 'enriched';

  function absorb(hit: EnrichHit | null) {
    if (!hit) return false;
    let got = false;
    if (hit.bpm && hit.bpm > 40 && hit.bpm < 220 && needsBpm && !bpm) { bpm = hit.bpm; source = hit.source; got = true; }
    if (hit.key && CAM_KEYS.includes(hit.key) && needsKey && !key) { key = hit.key; source = hit.source; got = true; }
    if (hit.genres?.length) { genres = [...new Set([...genres, ...hit.genres])]; got = true; }
    if (hit.styles?.length) { styles = [...new Set([...styles, ...hit.styles])]; got = true; }
    return got;
  }

  // 1. Tunebat
  absorb(await tunebatSearch(`${artist} ${title}`));
  if (bpm && key) return { id: track.id, bpm, key, genres, styles, source };
  await sleep(80);

  // 2. Beatport HTML
  absorb(await beatportSearch(artist, title));
  if (bpm && key) return { id: track.id, bpm, key, genres, styles, source };
  await sleep(80);

  // 3. Juno
  absorb(await junoSearch(artist, title, relTitle));
  if (bpm && key) return { id: track.id, bpm, key, genres, styles, source };
  await sleep(80);

  // 4. Last.fm (genres only — no BPM/key)
  absorb(await lastfmTrack(artist, title));
  await sleep(80);

  // 5. MusicBrainz + AcousticBrainz
  if (!bpm || !key) {
    const mbid = await mbSearch(artist, title);
    if (mbid) absorb(await abGet(mbid));
  }

  if (!bpm && !key && !genres.length && !styles.length) return null;
  return { id: track.id, bpm, key, genres, styles, source };
}
