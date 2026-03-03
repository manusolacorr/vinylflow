import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TRACKS = [
  { artist: 'Atmosfear', title: 'Dancing In Outer Space' },
  { artist: 'Harvey Mason', title: 'How Does It Feel' },
  { artist: 'William DeVaughn', title: "Be Thankful For What You've Got" },
  { artist: 'Ezy & Isaac', title: 'Let Your Body Move (Oba Balu Balu)' },
];

const CAM_KEYS = ['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
                  '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B'];

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
          max_tokens: 200,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: `Search for the BPM and musical key of "${t.title}" by ${t.artist}. Look on Tunebat, Beatport, or similar DJ databases. Reply ONLY with JSON: {"bpm": 124, "key": "8A"} where key is in Camelot notation. No explanation.` }]
        }),
        signal: AbortSignal.timeout(20000),
      });

      const data = await res.json();
      const textBlocks = (data?.content || []).filter((b: {type:string}) => b.type === 'text');
      const text = textBlocks.map((b: {text:string}) => b.text).join('');
      const match = text.match(/\{[^{}]*"bpm"[^{}]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      const bpm = parsed?.bpm && typeof parsed.bpm === 'number' ? Math.round(parsed.bpm) : null;
      const keyRaw = parsed?.key ? String(parsed.key).toUpperCase().trim() : null;
      const key = keyRaw && CAM_KEYS.includes(keyRaw) ? keyRaw : null;

      results.push({ ...t, bpm, key, raw_text: text.slice(0, 200) });
    } catch(e: unknown) { results.push({ ...t, error: String(e) }); }

    await new Promise(r => setTimeout(r, 500));
  }

  return NextResponse.json(results);
}
