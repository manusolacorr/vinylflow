import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TRACKS = [
  { artist: 'Harvey Mason', title: 'How Does It Feel' },
  { artist: 'Move D', title: 'Namlook XVI - Solitaire' },
  { artist: 'Space Ghost', title: 'Private Paradise' },
  { artist: 'Nerija', title: 'Gremi, Zemeljushka (Make The Ground Shake)' },
  { artist: 'William DeVaughn', title: 'Be Thankful For What You\'ve Got' },
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
          messages: [{ role: 'user', content: `What is the BPM and Camelot key of the specific track "${t.title}" by ${t.artist}?\nReply ONLY with JSON: {"bpm": 124, "key": "8A"}\nRules:\n- bpm: exact integer BPM if you are CERTAIN, otherwise null\n- key: Camelot wheel notation if CERTAIN, otherwise null\n- If EP/album title not a track, return {"bpm": null, "key": null}\n- Do NOT guess. Only JSON.` }]
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      results.push({ ...t, bpm: parsed?.bpm, key: parsed?.key });
    } catch(e: unknown) { results.push({ ...t, error: String(e) }); }
    await new Promise(r => setTimeout(r, 300));
  }
  return NextResponse.json(results);
}
