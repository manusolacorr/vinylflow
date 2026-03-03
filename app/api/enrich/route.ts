/**
 * POST /api/enrich
 * Body: { artist, title, genres?, styles? }
 * Returns: { bpm, key, source, confidence, correction }
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBpmKey } from '@/lib/validateBpmKey';
export const dynamic  = 'force-dynamic';
export const maxDuration = 60;

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

function normKey(raw: string): string | null {
  const up = raw.trim().toUpperCase();
  if (CAM_KEYS.includes(up)) return up;
  const lo = raw.trim().toLowerCase().replace(/[♯]/g,'#').replace(/[♭]/g,'b');
  if (KEY_TO_CAM[lo]) return KEY_TO_CAM[lo];
  const m = lo.match(/^([a-g][#b]?)\s*(major|minor|maj|min)/);
  if (m) return KEY_TO_CAM[`${m[1]} ${m[2].startsWith('min')?'minor':'major'}`] || null;
  return null;
}

function extractResult(text: string): { bpm: number | null; key: string | null } | null {
  const attempts = [
    text.match(/```(?:json)?\s*(\{[\s\S]*?"bpm"[\s\S]*?\})\s*```/),
    text.match(/(\{"bpm"\s*:\s*\d[\s\S]*?\})/),
    text.match(/(\{[\s\S]*?"bpm"\s*:[\s\S]*?\})/),
  ];
  for (const m of attempts) {
    if (!m) continue;
    try {
      const p = JSON.parse(m[1]);
      const bpm = typeof p.bpm === 'number' ? Math.round(p.bpm) : null;
      const key = p.key ? (normKey(String(p.key)) ?? null) : null;
      if (bpm || key) return { bpm, key };
    } catch { continue; }
  }
  const bpmM = text.match(/\b(\d{2,3})\s*(?:BPM|bpm)/);
  const keyM = text.match(/(?:key|Key)\s*[=:]\s*["']?([A-Ga-g][#b]?\s*(?:major|minor|maj|min))/i);
  const camM = text.match(/\b(\d{1,2}[ABab])\b/);
  const bpm  = bpmM ? parseInt(bpmM[1]) : null;
  const keyStr = keyM ? normKey(keyM[1]) : (camM ? camM[1].toUpperCase() : null);
  const key  = keyStr && CAM_KEYS.includes(keyStr) ? keyStr : null;
  return (bpm || key) ? { bpm, key } : null;
}

async function searchWithClaude(artist: string, title: string, genres: string[], styles: string[]): Promise<{ bpm: number | null; key: string | null } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const genreHint = [...genres, ...styles].slice(0, 4).join(', ');
  const prompt = `Find the BPM and musical key for "${title}" by ${artist}${genreHint ? ` (genre: ${genreHint})` : ''}.

Search Tunebat, Beatport, Juno Download, or any DJ music database.

IMPORTANT — Common detection errors to watch for:
- House/Techno tracks: BPM should be 118–135. If you find ~60–65 BPM, it is half-time, double it.
- Funk/Soul: BPM 80–120. If you find ~40–55, double it.
- A "swing" rhythm may cause half-time detection — real groove BPM is typically double.

Reply with ONLY this JSON on the last line:
{"bpm": 123, "key": "11A"}

Camelot key reference: C maj=8B, Db=3B, D=10B, Eb=5B, E=12B, F=7B, Gb=2B, G=9B, Ab=4B, A=11B, Bb=6B, B=1B, C min=5A, Db min=12A, D min=7A, Eb min=2A, E min=9A, F min=4A, Gb min=11A, G min=6A, Ab min=1A, A min=8A, Bb min=3A, B min=10A`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(55000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const allText = (data?.content || []).filter((b: {type:string}) => b.type === 'text').map((b: {text:string}) => b.text).join('\n');
    return extractResult(allText);
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    const { artist, title, genres = [], styles = [] } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });

    const raw = await searchWithClaude(artist, title, genres, styles);
    if (!raw) return NextResponse.json({ bpm: null, key: null, source: 'not_found', confidence: 'low', correction: null });

    // Run validation layer — catches half-time errors, out-of-range BPM
    const validated = validateBpmKey(raw.bpm, raw.key, genres, styles, artist);

    return NextResponse.json({
      bpm: validated.bpm,
      key: validated.key,
      source: 'web_search',
      confidence: validated.confidence,
      correction: validated.correction,
    });
  } catch (err: unknown) {
    return NextResponse.json({ bpm: null, key: null, source: 'error', confidence: 'low', correction: null });
  }
}
