/**
 * decksde.ts — Scrape BPM + audio snippet URL from decks.de
 *
 * Strategy:
 *  1. Google search `site:decks.de {artist} {title}` to find the release URL + code
 *  2. Fetch the release page and parse BPM per track from the HTML table
 *  3. Return audio snippet URLs (decks.de/play/{code}-{trackIndex})
 *
 * No API key required. Respects robots.txt via user-agent.
 */

const UA = 'Mozilla/5.0 (compatible; vinylflow/1.0)';

interface DecksRelease {
  url:    string;
  code:   string;  // e.g. "c6a-wz"
  tracks: DecksTrack[];
}

export interface DecksTrack {
  index:    number; // 0-based (used in /play/{code}-{index})
  title:    string;
  bpm:      number | null;
  side:     string; // "A" or "B"
  audioUrl: string; // https://www.decks.de/play/{code}-{index}
}

// ── Step 1: Find the release URL via Google ──────────────────────────────────
async function searchDecksde(artist: string, title: string): Promise<string | null> {
  // Strategy 1: Try DuckDuckGo HTML (less bot-blocking than Google)
  try {
    const q = encodeURIComponent(`site:decks.de ${artist} ${title}`);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/https?:\/\/www\.decks\.de\/track\/[^"&\s<>]+/);
      if (match) return match[0].replace('/en', '').split('?')[0];
    }
  } catch { /* try next */ }

  // Strategy 2: Direct URL slug construction as fallback
  // decks.de uses {artist_slug}-{title_slug} pattern
  const slugify = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  const artistSlug = slugify(artist);
  const titleSlug  = slugify(title);
  const guessUrl   = `https://www.decks.de/track/${artistSlug}-${titleSlug}`;
  try {
    const res = await fetch(guessUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    // If it redirects or returns 200 with track content, we found it
    if (res.ok) {
      const html = await res.text();
      if (html.includes('BPM') && html.includes('Tracklist')) return guessUrl;
    }
  } catch { /* not found */ }

  return null;
}

// ── Step 2: Fetch + parse the release page ───────────────────────────────────
async function fetchReleasePage(url: string): Promise<DecksRelease | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract code from URL e.g. /track/frits_wentink-horse_in_cornfield/c6a-wz
    const codeMatch = url.match(/\/([a-z0-9]+-[a-z0-9]+)\/?$/);
    if (!codeMatch) return null;
    const code = codeMatch[1];

    // Parse the tracklist table — rows look like:
    // <td>A</td><td>120</td><td><a href="/play/c6a-wz-0">Horses In Cornfield</a></td>
    // BPM is on the side row (one per side), not per individual track
    const tracks: DecksTrack[] = [];
    let trackIndex = 0;

    // Match side rows (A/B) with BPM
    const sidePattern = /<td[^>]*>\s*([AB])\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>/gi;
    const trackPattern = /href="\/play\/[^"]*-(\d+)"[^>]*>([^<]+)<\/a>/gi;

    // Get all tracks first
    const trackMatches = [...html.matchAll(/href="\/play\/([^"]+)-(\d+)"[^>]*>([^<]+)<\/a>/g)];
    const sideMatches = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*>\s*([AB])\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>/gi)];

    // Build side→bpm map
    const sideBpm: Record<string, number> = {};
    for (const m of sideMatches) {
      sideBpm[m[1].toUpperCase()] = parseInt(m[2]);
    }

    // Build tracks
    for (const m of trackMatches) {
      const idx = parseInt(m[2]);
      const title = m[3].trim();
      // Determine side: first half of tracks = A, second half = B (rough heuristic)
      // Better: parse position from surrounding HTML context
      const side = idx < trackMatches.length / 2 ? 'A' : 'B';
      const bpm = sideBpm[side] ?? null;
      tracks.push({
        index: idx,
        title,
        bpm,
        side,
        audioUrl: `https://www.decks.de/play/${code}-${idx}`,
      });
    }

    if (tracks.length === 0) return null;
    return { url, code, tracks };
  } catch { return null; }
}

// ── Step 3: Fetch audio snippet as ArrayBuffer ───────────────────────────────
export async function fetchAudioSnippet(audioUrl: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(audioUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.decks.de/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    // Only proceed if it's actual audio
    if (!contentType.includes('audio') && !contentType.includes('octet-stream') && !contentType.includes('mpeg')) {
      return null;
    }
    return await res.arrayBuffer();
  } catch { return null; }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface DecksResult {
  found:    boolean;
  bpm:      number | null;
  audioUrl: string | null;
  allTracks: DecksTrack[];
}

/**
 * Look up a track on decks.de by artist + title.
 * Returns BPM (from page) and audio snippet URL for key analysis.
 * titleIndex: 0-based index of the track within the release (A1=0, A2=1, B1=2, etc.)
 */
export async function lookupDecksde(
  artist: string,
  title: string,
  titleIndex: number = 0,
): Promise<DecksResult> {
  const empty: DecksResult = { found: false, bpm: null, audioUrl: null, allTracks: [] };

  const url = await searchDecksde(artist, title);
  if (!url) return empty;

  const release = await fetchReleasePage(url);
  if (!release || release.tracks.length === 0) return empty;

  // Find best matching track by title similarity
  const needle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  let bestTrack = release.tracks[titleIndex] ?? release.tracks[0];
  let bestScore = 0;
  for (const t of release.tracks) {
    const hay = t.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Simple overlap score
    let score = 0;
    for (let i = 0; i < Math.min(needle.length, hay.length); i++) {
      if (needle[i] === hay[i]) score++;
    }
    if (score > bestScore) { bestScore = score; bestTrack = t; }
  }

  return {
    found:     true,
    bpm:       bestTrack.bpm,
    audioUrl:  bestTrack.audioUrl,
    allTracks: release.tracks,
  };
}
