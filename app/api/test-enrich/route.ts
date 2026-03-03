import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TRACKS = [
  { artist: 'Harvey Mason', title: 'How Does It Feel' },
  { artist: 'William DeVaughn', title: "Be Thankful For What You've Got" },
  { artist: 'Ezy & Isaac', title: 'Let Your Body Move (Oba Balu Balu)' },
  { artist: 'Atmosfear', title: 'Dancing In Outer Space' },
  { artist: 'Frits Wentink', title: 'Horses In Cornfield' },
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
          messages: [{ role: 'user', content: `What is the BPM and Camelot key of "${t.title}" by ${t.artist}? Give your best estimate even if not 100% certain. Reply ONLY with JSON: {"bpm": 124, "key": "8A", "conf": "high"}. bpm = integer BPM, key = Camelot notation (e.g. 8A, 11B), conf = "high" if confident or "low" if uncertain. Return null only if completely unknown. No explanation, just JSON.` }]
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      results.push({ ...t, bpm: parsed?.bpm, key: parsed?.key, conf: parsed?.conf, raw: text });
    } catch(e: unknown) { results.push({ ...t, error: String(e) }); }
    await new Promise(r => setTimeout(r, 300));
  }
  return NextResponse.json(results);
}
