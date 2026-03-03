/**
 * Quick batch test — enriches 3 tracks and returns results
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TRACKS = [
  { artist: 'Harvey Mason', title: 'How Does It Feel' },
  { artist: 'Move D / Namlook', title: 'Reissued 002' },
  { artist: 'Cuthead', title: 'Brother EP' },
];

export async function GET(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const results = [];

  for (const t of TRACKS) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          messages: [{ role: 'user', content: `BPM and Camelot key of "${t.title}" by ${t.artist}? JSON only: {"bpm": 124, "key": "8A"}` }]
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      results.push({ ...t, status: res.status, bpm: parsed?.bpm, key: parsed?.key });
    } catch(e: unknown) {
      results.push({ ...t, error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return NextResponse.json(results);
}
