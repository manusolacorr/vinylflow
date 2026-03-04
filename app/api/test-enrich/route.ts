/**
 * GET /api/test-enrich
 * Tests enrichment on 4 gold-standard tracks and returns a score.
 * Frits Wentink "Rare Bird" EP — known correct values.
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const TRACKS = [
  { artist: 'Frits Wentink', title: 'Horses In Cornfield',       genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 123, key: '11A' } },
  { artist: 'Frits Wentink', title: 'Girls In Matching Outfits', genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 120, key: '1A'  } },
  { artist: 'Frits Wentink', title: 'Man At Parade',             genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 120, key: '10A' } },
  { artist: 'Frits Wentink', title: 'Bouquet At Rest',           genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 122, key: '6A'  } },
];

export async function GET(req: NextRequest) {
  const { origin } = new URL(req.url);
  const results = [];

  for (const t of TRACKS) {
    const start = Date.now();
    const res = await fetch(`${origin}/api/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: t.artist, title: t.title, genres: t.genres, styles: t.styles }),
    });
    const ms   = Date.now() - start;
    const data = await res.json();

    const bpmOk = data.bpm != null && Math.abs(data.bpm - t.expected.bpm) <= 3;
    const keyOk = data.key === t.expected.key;

    results.push({
      track:      `${t.artist} — ${t.title}`,
      got:        { bpm: data.bpm, key: data.key, source: data.source, confidence: data.confidence },
      expected:   t.expected,
      bpmOk,
      keyOk,
      pass:       bpmOk && keyOk,
      ms,
      correction: data.correction ?? null,
    });
  }

  const passed = results.filter(r => r.pass).length;
  return NextResponse.json({
    score:   `${passed}/${results.length}`,
    hasKey:  !!process.env.GEMINI_API_KEY,
    tracks:  results,
  }, { headers: { 'Content-Type': 'application/json' } });
}
