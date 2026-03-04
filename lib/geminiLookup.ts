/**
 * Shared BPM/key lookup using Claude Haiku (no web search).
 * Imported directly by both /api/enrich and /api/test-enrich.
 */
import { validateBpmKey } from '@/lib/validateBpmKey';

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
  const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    const p = JSON.parse(clean);
    const bpm = typeof p.bpm === 'number' && p.bpm > 0 ? Math.round(p.bpm) : null;
    const key = p.key ? normKey(String(p.key)) : null;
    if (bpm || key) return { bpm, key };
  } catch { /* fall through */ }
  const bpmM = clean.match(/\b(\d{2,3})\s*(?:BPM|bpm)/);
  const camM  = clean.match(/\b(\d{1,2}[ABab])\b/);
  const bpm   = bpmM ? parseInt(bpmM[1]) : null;
  const keyRaw = camM ? camM[1].toUpperCase() : null;
  const key    = keyRaw && CAM_KEYS.includes(keyRaw) ? keyRaw : null;
  return (bpm || key) ? { bpm, key } : null;
}

export interface EnrichResult {
  bpm: number | null;
  key: string | null;
  source: string;
  confidence: 'high' | 'low';
  correction: string | null;
}

export async function enrichTrack(
  artist: string,
  title: string,
  genres: string[],
  styles: string[],
): Promise<EnrichResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { bpm: null, key: null, source: 'no_api_key', confidence: 'low', correction: null };

  const genreHint = [...genres, ...styles].slice(0, 4).join(', ') || 'unknown';
  const prompt = `You are a DJ music database with knowledge of Beatport, Tunebat, Juno Download and record pools.
Return the BPM and Camelot key for this track from your training knowledge.

Artist: ${artist}
Title: ${title}
Genre: ${genreHint}

Rules:
- BPM must be DJ-playable tempo, never half-time or double-time
- Ranges: House 118-130, Deep House 118-126, Techno 128-145, Disco 108-128, Funk 85-115, Soul 70-110
- If you don't know this exact track, give a genre-appropriate estimate
- Convert key to Camelot notation (e.g. "11A", "8B")

Respond with ONLY this JSON, nothing else:
{"bpm": 120, "key": "8A"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return { bpm: null, key: null, source: 'api_error', confidence: 'low', correction: null };

    const data  = await res.json();
    const text  = data?.content?.[0]?.text ?? '';
    const raw   = parseResponse(text);

    if (!raw) return { bpm: null, key: null, source: 'parse_error', confidence: 'low', correction: null };

    const validated = validateBpmKey(raw.bpm, raw.key, genres, styles);
    return {
      bpm:        validated.bpm,
      key:        validated.key,
      source:     'claude',
      confidence: validated.confidence,
      correction: validated.correction,
    };
  } catch (e) {
    console.error('[enrichTrack]', e);
    return { bpm: null, key: null, source: 'timeout', confidence: 'low', correction: null };
  }
}
