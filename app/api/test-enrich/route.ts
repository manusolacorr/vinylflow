import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Gold standard: Frits Wentink "Rare Bird" EP
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
    const res = await fetch(`${origin}/api/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: t.artist, title: t.title, genres: t.genres, styles: t.styles }),
    });
    const data = await res.json();
    const bpmOk = data.bpm && t.expected.bpm ? Math.abs(data.bpm - t.expected.bpm) <= 2 : false;
    const keyOk = data.key === t.expected.key;
    results.push({ title: t.title, got: { bpm: data.bpm, key: data.key, confidence: data.confidence, correction: data.correction }, expected: t.expected, bpmOk, keyOk });
    await new Promise(r => setTimeout(r, 500));
  }
  return NextResponse.json({ tracks: results, score: `${results.filter(r => r.bpmOk && r.keyOk).length}/${results.length}` });
}
