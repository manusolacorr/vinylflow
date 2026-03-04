import { NextResponse } from 'next/server';
import { enrichTrack } from '@/lib/geminiLookup';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRACKS = [
  { artist: 'Frits Wentink', title: 'Horses In Cornfield',       genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 123, key: '11A' } },
  { artist: 'Frits Wentink', title: 'Girls In Matching Outfits', genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 120, key: '1A'  } },
  { artist: 'Frits Wentink', title: 'Man At Parade',             genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 120, key: '10A' } },
  { artist: 'Frits Wentink', title: 'Bouquet At Rest',           genres: ['Electronic'], styles: ['Deep House'], expected: { bpm: 122, key: '6A'  } },
];

export async function GET() {
  const results = [];
  for (const t of TRACKS) {
    const start  = Date.now();
    const result = await enrichTrack(t.artist, t.title, t.genres, t.styles);
    const ms     = Date.now() - start;
    const bpmOk  = result.bpm != null && Math.abs(result.bpm - t.expected.bpm) <= 3;
    const keyOk  = result.key === t.expected.key;
    results.push({
      track: `${t.artist} — ${t.title}`,
      got: { bpm: result.bpm, key: result.key, source: result.source, confidence: result.confidence },
      expected: t.expected,
      bpmOk, keyOk,
      pass: bpmOk && keyOk,
      ms,
      correction: result.correction,
    });
  }
  const passed = results.filter(r => r.pass).length;
  return NextResponse.json({ score: `${passed}/${results.length}`, tracks: results });
}
