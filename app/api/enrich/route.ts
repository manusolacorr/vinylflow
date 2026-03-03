/**
 * POST /api/enrich
 * Body: { artist, title, genres?, styles? }
 * Returns: { bpm, key, source, confidence, correction }
 *
 * Pipeline:
 * 1. Claude web search → raw BPM/key from Tunebat/Beatport
 * 2. Genre-aware validation → catch half-time / double-time errors  
 * 3. Gemini Flash → sanity check + correction if confidence is low
 */
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { validateBpmKey } from '@/lib/validateBpmKey';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Key normalisation ─────────────────────────────────────────────────────
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

function extractJSON(text: string): { bpm: number | null; key: string | null } | null {
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
  const camM = text.match(/\b(\d{1,2}[ABab])\b/);
  const bpm = bpmM ? parseInt(bpmM[1]) : null;
  const key = camM ? camM[1].toUpperCase() : null;
  return (bpm || key) ? { bpm, key: key && CAM_KEYS.includes(key) ? key : null } : null;
}

// ── Step 1: Claude web search ─────────────────────────────────────────────
async function searchWithClaude(
  artist: string, title: string, genres: string[], styles: string[]
): Promise<{ bpm: number | null; key: string | null } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const genreHint = [...genres, ...styles].slice(0, 4).join(', ');
  const prompt = `Find the BPM and musical key for "${title}" by ${artist}${genreHint ? ` (genre: ${genreHint})` : ''}.
Search Tunebat, Beatport, or Juno Download.
IMPORTANT: House/Techno BPM range is 118–135. If you find ~60–65 BPM it is a half-time error — double it.
Reply with ONLY this JSON on the last line:
{"bpm": 123, "key": "11A"}
Camelot: C maj=8B, Db=3B, D=10B, Eb=5B, E=12B, F=7B, Gb=2B, G=9B, Ab=4B, A=11B, Bb=6B, B=1B, C min=5A, Db min=12A, D min=7A, Eb min=2A, E min=9A, F min=4A, Gb min=11A, G min=6A, Ab min=1A, A min=8A, Bb min=3A, B min=10A`;

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
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.content || []).filter((b: {type:string}) => b.type === 'text').map((b: {text:string}) => b.text).join('\n');
    return extractJSON(text);
  } catch { return null; }
}

// ── Step 3: Gemini Flash validation (runs when confidence is low) ──────────
async function validateWithGemini(
  artist: string,
  title: string,
  rawBpm: number | null,
  rawKey: string | null,
  genres: string[],
  styles: string[],
): Promise<{ bpm: number | null; key: string | null; correction: string } | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const genreHint = [...genres, ...styles].slice(0, 4).join(', ') || 'unknown';
    const prompt = `Identify the correct DJ metadata for: "${artist} - ${title}".
Genre context: ${genreHint}
Current API returned: BPM=${rawBpm ?? 'unknown'}, Key=${rawKey ?? 'unknown'}

This may be a half-time error (e.g. 60 BPM reported for a 120 BPM House track).
Common ranges: House 118–130, Deep House 118–126, Techno 128–145, Disco 108–128, Funk 85–115, Soul 70–110.

Return ONLY a JSON object, no other text:
{
  "corrected_bpm": number,
  "camelot_key": string,
  "correction_note": string,
  "is_verified": boolean
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip markdown fences if present
    const clean = text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(clean);

    const bpm = typeof parsed.corrected_bpm === 'number' ? Math.round(parsed.corrected_bpm) : null;
    const key = parsed.camelot_key ? (normKey(String(parsed.camelot_key)) ?? null) : null;
    const correction = parsed.correction_note || 'Gemini validation applied';

    return (bpm || key) ? { bpm, key, correction } : null;
  } catch (e) {
    console.error('[gemini]', e);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { artist, title, genres = [], styles = [] } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });

    // Step 1: web search
    const raw = await searchWithClaude(artist, title, genres, styles);

    // Step 2: genre-aware validation (catches half-time errors algorithmically)
    const validated = validateBpmKey(raw?.bpm ?? null, raw?.key ?? null, genres, styles);

    // Step 3: if confidence is still low, ask Gemini to verify/correct
    if (validated.confidence === 'low') {
      const geminiResult = await validateWithGemini(
        artist, title, validated.bpm, validated.key, genres, styles
      );
      if (geminiResult?.bpm || geminiResult?.key) {
        return NextResponse.json({
          bpm: geminiResult.bpm ?? validated.bpm,
          key: geminiResult.key ?? validated.key,
          source: 'gemini_validated',
          confidence: 'high',
          correction: [validated.correction, geminiResult.correction].filter(Boolean).join(' → '),
        });
      }
    }

    // Return validated result
    if (validated.bpm || validated.key) {
      return NextResponse.json({
        bpm: validated.bpm,
        key: validated.key,
        source: raw ? 'web_search' : 'not_found',
        confidence: validated.confidence,
        correction: validated.correction,
      });
    }

    return NextResponse.json({ bpm: null, key: null, source: 'not_found', confidence: 'low', correction: null });
  } catch (err) {
    console.error('[enrich]', err);
    return NextResponse.json({ bpm: null, key: null, source: 'error', confidence: 'low', correction: null });
  }
}
