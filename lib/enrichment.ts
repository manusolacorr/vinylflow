/**
 * enrichment.ts — Two-pass BPM/key enrichment:
 * Pass 1 — BPM via Claude Haiku (~500ms, cheap, works well)
 * Pass 2 — Key via Claude Sonnet (better music knowledge, targeted prompt)
 *
 * Sonnet cost: ~$0.001 per track. 894 tracks ≈ $0.90 total.
 */
import { validateBpmKey } from '@/lib/validateBpmKey';
import { lookupBeatport } from '@/lib/beatport';
import { findSnippet } from '@/lib/snippetSources';

const CAM_KEYS = ['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
                  '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B'];

const KEY_TO_CAM: Record<string, string> = {
  'c major':'8B','c minor':'5A','c# major':'3B','c# minor':'12A','db major':'3B','db minor':'12A',
  'd major':'10B','d minor':'7A','d# major':'5B','d# minor':'2A','eb major':'5B','eb minor':'2A',
  'e major':'12B','e minor':'9A','f major':'7B','f minor':'4A',
  'f# major':'2B','f# minor':'11A','gb major':'2B','gb minor':'11A',
  'g major':'9B','g minor':'6A','g# major':'4B','g# minor':'1A','ab major':'4B','ab minor':'1A',
  'a major':'11B','a minor':'8A','a# major':'6B','a# minor':'3A','bb major':'6B','bb minor':'3A',
  'b major':'1B','b minor':'10A',
};

export function normKey(raw: string): string | null {
  const up = raw.trim().toUpperCase();
  if (CAM_KEYS.includes(up)) return up;
  const lo = raw.trim().toLowerCase().replace(/[♯]/g,'#').replace(/[♭]/g,'b');
  if (KEY_TO_CAM[lo]) return KEY_TO_CAM[lo];
  const m = lo.match(/^([a-g][#b]?)\s*(major|minor|maj|min)/);
  if (m) return KEY_TO_CAM[`${m[1]} ${m[2].startsWith('min') ? 'minor' : 'major'}`] || null;
  return null;
}

export function parseResponse(text: string): { bpm: number | null; key: string | null } | null {
  const clean = text.replace(/```(?:json)?/g, '').trim();
  const jsonMatches = clean.match(/\{[^{}]+\}/g) || [];
  for (const jsonStr of jsonMatches) {
    try {
      const p = JSON.parse(jsonStr);
      const bpmRaw = p.bpm ?? p.tempo ?? p.bpm_value ?? p.corrected_bpm;
      const keyRaw = p.key ?? p.camelot_key ?? p.camelot ?? p.musical_key;
      const bpm = typeof bpmRaw === 'number' && bpmRaw > 40 && bpmRaw < 220 ? Math.round(bpmRaw) : null;
      const key = keyRaw ? normKey(String(keyRaw)) : null;
      if (bpm || key) return { bpm, key };
    } catch { continue; }
  }
  const bpmM = clean.match(/\b(\d{2,3})\s*(?:BPM|bpm|Bpm)?(?:\s|$|,|})/);
  const camM  = clean.match(/\b(\d{1,2}[ABab])\b/);
  const keyM  = clean.match(/(?:key|Key)["'\s]*[=:]["'\s]*([A-Ga-g][#b]?\s*(?:major|minor|maj|min))/i);
  const bpm   = bpmM ? parseInt(bpmM[1]) : null;
  const keyStr = camM ? camM[1].toUpperCase() : keyM ? normKey(keyM[1]) : null;
  const key    = keyStr && CAM_KEYS.includes(keyStr) ? keyStr : null;
  return (bpm || key) ? { bpm, key } : null;
}

async function claudeRequest(model: string, prompt: string, maxTokens: number, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.content?.[0]?.text ?? null;
  } catch { return null; }
}

// ── Pass 1: BPM via Haiku ─────────────────────────────────────────────────
async function getBpm(artist: string, title: string, genres: string[], styles: string[], apiKey: string): Promise<number | null> {
  const genreHint = [...genres, ...styles].slice(0, 4).join(', ') || 'unknown';
  const prompt = `Return the DJ-playable BPM for: "${artist} - ${title}" (${genreHint}).
Rules: never half-time/double-time. Ranges: House 118-130, Deep House 118-126, Techno 128-145, Disco 108-128, Funk 85-115, Soul 70-110.
Respond ONLY with: {"bpm": 120}`;
  const text = await claudeRequest('claude-haiku-4-5-20251001', prompt, 30, apiKey);
  if (!text) return null;
  const parsed = parseResponse(text);
  return parsed?.bpm ?? null;
}

// ── Pass 2: Key via Sonnet ────────────────────────────────────────────────
// Note: web search was tried but too slow + unreliable for obscure vinyl.
// Sonnet works well for well-known records; obscure ones need the audio analyser.
async function getKey(artist: string, title: string, genres: string[], styles: string[], bpm: number | null, apiKey: string): Promise<string | null> {
  const genreHint = [...genres, ...styles].slice(0, 4).join(', ') || 'unknown';
  const bpmHint = bpm ? `BPM is ${bpm}. ` : '';

  const prompt = `You are an expert DJ and music analyst with deep knowledge of electronic music, soul, funk, disco and jazz records.

Identify the musical key of this specific track: "${artist} - ${title}"
Genre: ${genreHint}
${bpmHint}
Think about what you know about this specific record from Beatport, Discogs, or music databases.

IMPORTANT: Do NOT default to A minor / 8A. Only use 8A if genuinely confident.
The 24 Camelot values are equally likely — pick the correct one for this track.

Camelot reference:
C maj=8B  Db maj=3B  D maj=10B  Eb maj=5B  E maj=12B  F maj=7B  Gb maj=2B  G maj=9B  Ab maj=4B  A maj=11B  Bb maj=6B  B maj=1B
C min=5A  Db min=12A  D min=7A  Eb min=2A  E min=9A  F min=4A  Gb min=11A  G min=6A  Ab min=1A  A min=8A  Bb min=3A  B min=10A

Respond ONLY with: {"key": "11A"}`;

  const text = await claudeRequest('claude-sonnet-4-6', prompt, 50, apiKey);
  if (!text) return null;
  const parsed = parseResponse(text);
  return parsed?.key ?? null;
}

// ── Main export ───────────────────────────────────────────────────────────
export interface EnrichResult {
  bpm:        number | null;
  key:        string | null;
  audioUrl:   string | null;
  source:     string;
  confidence: 'high' | 'low';
  correction: string | null;
}

export async function enrichTrack(
  artist: string,
  title: string,
  genres: string[],
  styles: string[],
  catno?: string,
): Promise<EnrichResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { bpm: null, key: null, audioUrl: null, source: 'no_api_key', confidence: 'low', correction: null };

  let bpmRaw: number | null = null;
  let keyRaw: string | null = null;
  let audioUrlOut: string | null = null;
  let source = 'claude';

  // ── Run Beatport + Claude in TRUE parallel ────────────────────────────────
  // Beatport wins if found (real data). Claude is always the safety net.
  const [bp, claudeBpm, claudeKey] = await Promise.all([
    lookupBeatport(artist, title, catno).catch(() => null),
    getBpm(artist, title, genres, styles, apiKey).catch(() => null),
    getKey(artist, title, genres, styles, null, apiKey).catch(() => null),
  ]);

  // Beatport takes priority when found
  if (bp?.found) {
    if (bp.bpm) { bpmRaw = bp.bpm; source = 'beatport'; }
    if (bp.key) { keyRaw = bp.key; source = 'beatport'; }
    if (bp.audioUrl) audioUrlOut = bp.audioUrl;
  }

  // Fill gaps with Claude results
  if (!bpmRaw && claudeBpm) { bpmRaw = claudeBpm; }
  if (!keyRaw && claudeKey) { keyRaw = claudeKey; }
  if (source !== 'beatport' && (bpmRaw || keyRaw)) source = 'claude';
  if (source === 'beatport' && (!bp?.bpm || !bp?.key)) source = 'beatport+claude';

  if (!bpmRaw && !keyRaw) return { bpm: null, key: null, audioUrl: audioUrlOut, source: 'not_found', confidence: 'low', correction: null };

  const validated = validateBpmKey(bpmRaw, keyRaw, genres, styles);
  return {
    bpm:        validated.bpm,
    key:        validated.key,
    audioUrl:   audioUrlOut,
    source,
    confidence: validated.confidence,
    correction: validated.correction,
  };
}
