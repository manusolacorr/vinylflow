/**
 * snippetSources.ts — Multi-source vinyl shop scraper
 *
 * Strategy: catalog number first (direct URL construction), then search fallback.
 * Underground boutique shops block datacenter IPs less aggressively than big retailers.
 *
 * Shop priority:
 *  1. Clone.nl       — Dutch electronic, excellent metadata for Clone distribution labels
 *  2. Boomkat        — Experimental/IDM, track-by-track snippets for almost every release
 *  3. Rush Hour      — Amsterdam house, source-of-truth for that scene
 *  4. Juno Records   — Broad catalog, BPM often in HTML
 *  5. Decks.de       — German/EU techno, BPM in tracklist table
 *  6. Hardwax        — Basic Channel/Chain Reaction, minimalist but authoritative
 *  7. HHV            — German warehouse, retail-ready EAN/UPC metadata
 *  8. Phonica        — London boutique/private presses
 *  9. Bleep          — Warp/experimental, high-bitrate previews
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

async function fetchHtml(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function extractAudioUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /<audio[^>]+src=["']([^"']+\.(?:mp3|ogg|aac|m4a)[^"']*)["']/i,
    /<source[^>]+src=["']([^"']+\.(?:mp3|ogg|aac|m4a)[^"']*)["']/i,
    /<(?:audio|source)[^>]+data-src=["']([^"']+\.(?:mp3|ogg|aac|m4a)[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.(?:mp3|ogg|aac|m4a)(?:\?[^"']*)?)["']/i,
    /previewUrl["'\s:]+["']([^"']+\.(?:mp3|ogg|aac|m4a)[^"']*)["']/i,
    /preview_url["'\s:]+["']([^"']+)["']/i,
    /"stream":\s*"([^"]+)"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href;
  }
  return null;
}

function extractBpm(html: string): number | null {
  const patterns = [
    /(\d{2,3})\s*BPM/i,
    /"bpm"\s*:\s*(\d{2,3})/i,
    /bpm[^:]*:\s*(\d{2,3})/i,
    /tempo[^:]*:\s*(\d{2,3})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const bpm = parseInt(m[1]);
      if (bpm >= 60 && bpm <= 220) return bpm;
    }
  }
  return null;
}

async function tryShop(
  name: string,
  urls: string[],
): Promise<SnippetResult> {
  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;
    // Verify it's actually a product/track page, not a search results/error page
    const isProductPage = html.includes('mp3') || html.includes('ogg') ||
      html.includes('BPM') || html.includes('preview') ||
      html.includes('tracklist') || html.includes('Tracklist');
    if (!isProductPage) continue;

    const audioUrl = extractAudioUrl(html, url);
    const bpm = extractBpm(html);
    if (audioUrl || bpm) {
      return { bpm, audioUrl, source: name, found: true };
    }
  }
  return EMPTY;
}

// ── Source builders ───────────────────────────────────────────────────────────

function cloneNlUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://clone.nl/search/${encodeURIComponent(catno)}`);
  urls.push(`https://clone.nl/search/${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

function boomkatUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://boomkat.com/search?q=${encodeURIComponent(catno)}`);
  urls.push(`https://boomkat.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

function rushHourUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://www.rushhour.nl/search?q=${encodeURIComponent(catno)}`);
  urls.push(`https://www.rushhour.nl/search?q=${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

function junoUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://www.juno.co.uk/search/?q=${encodeURIComponent(catno)}`);
  urls.push(`https://www.juno.co.uk/search/?q=${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

function decksUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://www.decks.de/find?term=${encodeURIComponent(catno)}`);
  // Try direct slug: decks.de/track/{artist_slug}-{title_slug}
  const slug = `${slugify(artist)}-${slugify(title)}`;
  urls.push(`https://www.decks.de/track/${slug}`);
  urls.push(`https://www.decks.de/search?q=${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

function hardwaxUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://hardwax.com/search/?q=${encodeURIComponent(catno)}&type=release`);
  urls.push(`https://hardwax.com/search/?q=${encodeURIComponent(`${artist} ${title}`)}&type=release`);
  return urls;
}

function hhvUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://www.hhv.de/search?q=${encodeURIComponent(catno)}`);
  urls.push(`https://www.hhv.de/search?q=${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

function phonicaUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://www.phonicarecords.com/search?term=${encodeURIComponent(catno)}`);
  urls.push(`https://www.phonicarecords.com/search?term=${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

function bleepUrls(artist: string, title: string, catno?: string): string[] {
  const urls: string[] = [];
  if (catno) urls.push(`https://bleep.com/search#q=${encodeURIComponent(catno)}`);
  urls.push(`https://bleep.com/search#q=${encodeURIComponent(`${artist} ${title}`)}`);
  return urls;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function findSnippet(
  artist: string,
  title: string,
  catno?: string,
): Promise<SnippetResult> {
  // Run all shops in parallel — boutique shops are less likely to block datacenter IPs
  const results = await Promise.allSettled([
    tryShop('clone.nl',  cloneNlUrls(artist, title, catno)),
    tryShop('boomkat',   boomkatUrls(artist, title, catno)),
    tryShop('rush hour', rushHourUrls(artist, title, catno)),
    tryShop('juno',      junoUrls(artist, title, catno)),
    tryShop('decks.de',  decksUrls(artist, title, catno)),
    tryShop('hardwax',   hardwaxUrls(artist, title, catno)),
    tryShop('hhv',       hhvUrls(artist, title, catno)),
    tryShop('phonica',   phonicaUrls(artist, title, catno)),
    tryShop('bleep',     bleepUrls(artist, title, catno)),
  ]);

  // Return first shop that found audio — prefer audioUrl over BPM-only
  let bpmOnlyResult: SnippetResult | null = null;

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.found) {
      if (r.value.audioUrl) return r.value; // audio wins immediately
      if (!bpmOnlyResult) bpmOnlyResult = r.value; // keep first BPM-only as fallback
    }
  }

  return bpmOnlyResult ?? EMPTY;
}
