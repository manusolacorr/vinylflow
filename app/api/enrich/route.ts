/**
 * POST /api/enrich
 * Body: { artist, title, genres?, styles? }
 * Returns: { bpm, key, source, confidence, correction }
 *
 * Pipeline (optimised for Vercel Hobby 10s limit):
 * 1. Gemini Flash — answers from training data in ~1-3s
 * 2. validateBpmKey — genre-aware half-time/double-time correction
 */
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { validateBpmKey } from '@/lib/validateBpmKey';

export const dynamic     = 'force-dynamic';
export const maxDuration = 10;

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
  if (m) return KEY_TO_CAM[`${m[1]} ${m[2].startsWith('min') ? 'minor' : 'major'}`] || null;
  return null;
}

function parseResponse(text: string): { bpm: number | null; key: string | null } | null {
  const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    const p = JSON.parse(clean);
    const bpm = typeof p.bpm === 'number' && p.bpm > 0 ? Math.round(p.bpm) : null;
    const key = p.key ? normKey(String(p.key)) : null;
    if (bpm || key) return { bpm, key };
  } catch { /* fall through */ }
  const bpmM = clean.match(/\b(\d{2,3})\s*(?:BPM|bpm)/);
  const camM  = clean.match(/\b(\d{1,2}[ABab])\b/);
  const bpm = bpmM ? parseInt(bpmM[1]) : null;
  const keyRaw = camM ? camM[1].toUpperCase() : null;
  const key = keyRaw && CAM_KEYS.includes(keyRaw) ? keyRaw : null;
  return (bpm || key) ? { bpm, key } : null;
}

async function lookupWithGemini(
  artist: string, title: string, genres: string[], styles: string[],
): Promise<{ bpm: number | null; key: string | null } | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;

  const genreHint = [...genres, ...styles].slice(0, 4).join(', ') || 'unknown';
  const prompt = `You are a DJ music database. Return the BPM and musical key for this track.

Artist: ${artist}
Title: ${title}
Genre: ${genreHint}

Rules:
- Use your knowledge of Beatport, Tunebat, Juno Download, DJ record pools
- BPM must be the DJ-playable tempo, never half-time or double-time
- Ranges: House 118-130, Deep House 118-126, Techno 128-145, Disco 108-128, Funk 85-115, Soul 70-110, Jazz 60-200
- Convert key to Camelot notation (e.g. "11A", "8B")
- If unknown, make a genre-appropriate estimate and set is_estimate true

Respond with ONLY this JSON, no other text:
{"bpm": 120, "key": "8A", "is_estimate": false}`;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: { maxOutputTokens: 80, temperature: 0.1 },
    });
    const result = await model.generateContent(prompt);
    return parseResponse(result.response.text());
  } catch (e) {
    console.error('[gemini]', e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { artist, title, genres = [], styles = [] } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });

    const raw = await lookupWithGemini(artist, title, genres, styles);
    if (!raw) {
      return NextResponse.json({
        bpm: null, key: null,
        source: process.env.GEMINI_API_KEY ? 'not_found' : 'no_api_key',
        confidence: 'low', correction: null,
      });
    }

    const validated = validateBpmKey(raw.bpm, raw.key, genres, styles);
    return NextResponse.json({
      bpm: validated.bpm, key: validated.key,
      source: 'gemini', confidence: validated.confidence, correction: validated.correction,
    });
  } catch (err) {
    console.error('[enrich]', err);
    return NextResponse.json({ bpm: null, key: null, source: 'error', confidence: 'low', correction: null });
  }
}
