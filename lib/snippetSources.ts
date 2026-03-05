/**
 * snippetSources.ts — Multi-source vinyl shop scraper
 *
 * Priority: Juno Records → Decks.de → Traxsource
 * Each source is tried in order. First hit wins.
 *
 * Returns: { bpm, audioUrl, source } where
 *   bpm      — scraped from shop HTML (reliable, human-curated)
 *   audioUrl — direct URL to the audio snippet (MP3/OGG/AAC)
 *   source   — which shop found it
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface SnippetResult {
  bpm:      number | null;
  audioUrl: string | null;
  source:   string | null;
  found:    boolean;
}

const EMPTY: SnippetResult = { bpm: null, audioUrl: null, source: null, found: false };

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function underscored(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function fetchHtml(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

// Extract first <audio src> or data-src from HTML
function extractAudioUrl(html: string, baseUrl: string): string | null {
  // Try <audio src="...">
  let m = html.match(/<audio[^>]+src=["']([^"']+\.(?:mp3|ogg|aac|m4a)[^"']*)["']/i);
  if (m) return m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href;

  // Try data-src on audio elements
  m = html.match(/<(?:audio|source)[^>]+data-src=["']([^"']+\.(?:mp3|ogg|aac|m4a)[^"']*)["']/i);
  if (m) return m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href;

  // Try src in source tags
  m = html.match(/<source[^>]+src=["']([^"']+\.(?:mp3|ogg|aac|m4a)[^"']*)["']/i);
  if (m) return m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href;

  // Try generic mp3/ogg URLs in the page
  m = html.match(/["'](https?:\/\/[^"']+\.(?:mp3|ogg|aac|m4a)(?:\?[^"']*)?)["']/i);
  if (m) return m[1];

  return null;
}

// ── Source 1: Juno Records ───────────────────────────────────────────────────
// Juno search by catalog number is very reliable — they index almost everything
// URL: https://www.juno.co.uk/products/{slug}/
// Search: https://www.juno.co.uk/search/?q={catno}&x=0&y=0

async function tryJuno(artist: string, title: string, catno?: string): Promise<SnippetResult> {
  // Try catalog number search first (most reliable)
  const queries = catno
    ? [`https://www.juno.co.uk/search/?q=${encodeURIComponent(catno)}`,
       `https://www.juno.co.uk/search/?q=${encodeURIComponent(`${artist} ${title}`)}`]
    : [`https://www.juno.co.uk/search/?q=${encodeURIComponent(`${artist} ${title}`)}`];

  for (const searchUrl of queries) {
    const html = await fetchHtml(searchUrl);
    if (!html) continue;

    // Extract first product URL from search results
    const productMatch = html.match(/href="(\/products\/[^"]+\/)"/);
    if (!productMatch) continue;

    const productUrl = `https://www.juno.co.uk${productMatch[1]}`;
    const productHtml = await fetchHtml(productUrl);
    if (!productHtml) continue;

    const audioUrl = extractAudioUrl(productHtml, productUrl);

    // Parse BPM — Juno shows it as "120 BPM" in track listings
    const bpmMatch = productHtml.match(/(\d{2,3})\s*BPM/i);
    const bpm = bpmMatch ? parseInt(bpmMatch[1]) : null;

    if (audioUrl || bpm) {
      return { bpm, audioUrl, source: 'juno', found: true };
    }
  }
  return EMPTY;
}

// ── Source 2: Decks.de ───────────────────────────────────────────────────────
// Decks.de has BPM per track in their HTML tables + audio snippets
// URL pattern: https://www.decks.de/track/{artist_slug}-{title_slug}/{code}

async function tryDecksde(artist: string, title: string, catno?: string): Promise<SnippetResult> {
  // Try direct slug construction first
  const artistSlug = underscored(artist);
  const titleSlug  = underscored(title);

  // Decks.de URL: /track/{artist}-{title}/{code} — we don't know the code
  // but we can search via DuckDuckGo
  const searchQueries = [
    catno ? `https://html.duckduckgo.com/html/?q=site:decks.de+${encodeURIComponent(catno)}` : null,
    `https://html.duckduckgo.com/html/?q=site:decks.de+${encodeURIComponent(artist)}+${encodeURIComponent(title)}`
  ].filter(Boolean) as string[];

  for (const searchUrl of searchQueries) {
    const searchHtml = await fetchHtml(searchUrl);
    if (!searchHtml) continue;

    const urlMatch = searchHtml.match(/https?:\/\/www\.decks\.de\/track\/[^"&\s<>]+/);
    if (!urlMatch) continue;

    const pageUrl = urlMatch[0].replace('/en', '').split('?')[0];
    const html = await fetchHtml(pageUrl);
    if (!html) continue;

    // Extract code from URL: /track/artist-title/CODE
    const codeMatch = pageUrl.match(/\/([a-z0-9]+-[a-z0-9]+)\/?$/);
    if (!codeMatch) continue;
    const code = codeMatch[1];

    // Parse BPM from tracklist table
    const bpmMatch = html.match(/<td[^>]*>\s*(\d{2,3})\s*<\/td>/);
    const bpm = bpmMatch ? parseInt(bpmMatch[1]) : null;

    // Find matching track index (A1=0, A2=1, B1=2...)
    // For now use index 0 as default
    const audioUrl = `https://www.decks.de/play/${code}-0`;

    return { bpm, audioUrl, source: 'decks.de', found: true };
  }

  // Fallback: try direct URL if we can guess the slug
  const guessUrl = `https://www.decks.de/track/${artistSlug}-${underscored(title)}`;
  const html = await fetchHtml(guessUrl);
  if (html && html.includes('BPM') && html.includes('Tracklist')) {
    const codeMatch = guessUrl.match(/\/([a-z0-9]+-[a-z0-9]+)\/?$/);
    const code = codeMatch?.[1];
    const bpmMatch = html.match(/<td[^>]*>\s*(\d{2,3})\s*<\/td>/);
    const bpm = bpmMatch ? parseInt(bpmMatch[1]) : null;
    const audioUrl = code ? `https://www.decks.de/play/${code}-0` : null;
    if (bpm || audioUrl) return { bpm, audioUrl, source: 'decks.de', found: true };
  }

  return EMPTY;
}

// ── Source 3: Traxsource ─────────────────────────────────────────────────────
// Traxsource has key + BPM displayed on track listings for most releases
// Search: https://www.traxsource.com/search?term={artist}+{title}

async function tryTraxsource(artist: string, title: string): Promise<SnippetResult> {
  const q = encodeURIComponent(`${artist} ${title}`);
  const searchUrl = `https://www.traxsource.com/search?term=${q}&cn=tracks`;
  const html = await fetchHtml(searchUrl);
  if (!html) return EMPTY;

  // Extract first track URL
  const trackMatch = html.match(/href="(\/title\/\d+\/[^"]+)"/);
  if (!trackMatch) return EMPTY;

  const trackUrl = `https://www.traxsource.com${trackMatch[1]}`;
  const trackHtml = await fetchHtml(trackUrl);
  if (!trackHtml) return EMPTY;

  // Traxsource shows BPM and key in the metadata
  const bpmMatch  = trackHtml.match(/(\d{2,3})\s*BPM/i);
  const bpm       = bpmMatch ? parseInt(bpmMatch[1]) : null;
  const audioUrl  = extractAudioUrl(trackHtml, trackUrl);

  // Traxsource also shows key — extract it
  const keyMatch  = trackHtml.match(/Key[^:]*:\s*([A-G][b#]?\s*(?:maj|min|major|minor))/i);

  return {
    bpm,
    audioUrl,
    source: 'traxsource',
    found: !!(bpm || audioUrl),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function findSnippet(
  artist: string,
  title: string,
  catno?: string,
): Promise<SnippetResult> {
  // Run all sources in parallel, take first successful result
  const [juno, decks, trax] = await Promise.allSettled([
    tryJuno(artist, title, catno),
    tryDecksde(artist, title, catno),
    tryTraxsource(artist, title),
  ]);

  for (const result of [juno, decks, trax]) {
    if (result.status === 'fulfilled' && result.value.found) {
      return result.value;
    }
  }

  return EMPTY;
}
