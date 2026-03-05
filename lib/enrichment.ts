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
async function getBpmAndKey(
  artist: string,
  title: string,
  genres: string[],
  styles: string[],
  apiKey: string,
): Promise<{ bpm: number | null; key: string | null }> {
  const genreHint = [...genres, ...styles].slice(0, 4).join(', ') || 'unknown';
  const prompt = `You are an expert DJ with deep knowledge of electronic music, house, techno, disco, funk and soul.

For the track: "${artist} - ${title}" (${genreHint})

Return BOTH the BPM and Camelot key. Rules:
- BPM: never half-time or double-time. House/Deep House: 118-130, Techno: 128-145, Disco: 108-128, Funk: 85-115, Soul: 70-110
- Key: use the exact Camelot value from this list:
  1A=Ab min  1B=B maj   2A=Eb min  2B=F# maj  3A=Bb min  3B=Db maj
  4A=F min   4B=Ab maj  5A=C min   5B=Eb maj  6A=G min   6B=Bb maj
  7A=D min   7B=F maj   8A=A min   8B=C maj   9A=E min   9B=G maj
  10A=B min  10B=D maj  11A=F# min 11B=A maj  12A=C# min 12B=E maj

Respond ONLY with JSON: {"bpm": 120, "key": "11A"}`;

  const text = await claudeRequest('claude-sonnet-4-6', prompt, 60, apiKey);
  if (!text) return { bpm: null, key: null };
  const parsed = parseResponse(text);
  return { bpm: parsed?.bpm ?? null, key: parsed?.key ?? null };
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
  const [bp, claudeResult] = await Promise.all([
    lookupBeatport(artist, title, catno).catch(() => null),
    getBpmAndKey(artist, title, genres, styles, apiKey).catch(() => null),
  ]);

  // Beatport takes priority when found (real data)
  if (bp?.found) {
    if (bp.bpm) { bpmRaw = bp.bpm; source = 'beatport'; }
    if (bp.key) { keyRaw = bp.key; source = 'beatport'; }
    if (bp.audioUrl) audioUrlOut = bp.audioUrl;
  }

  // Fill gaps with Claude results
  if (!bpmRaw && claudeResult?.bpm) bpmRaw = claudeResult.bpm;
  if (!keyRaw && claudeResult?.key) keyRaw = claudeResult.key;
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
