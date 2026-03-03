import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || 'Harvey Mason';
  const title  = searchParams.get('title')  || 'How Does It Feel';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const results: Record<string, unknown> = { artist, title, has_key: !!apiKey };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: `What is the BPM and musical key of "${title}" by ${artist}? Reply ONLY with JSON: {"bpm": 124, "key": "8A"}. key must be Camelot notation. No explanation.` }]
      }),
      signal: AbortSignal.timeout(10000),
    });
    results.status = res.status;
    const data = await res.json();
    results.full_response = data;
    const text = data?.content?.[0]?.text;
    results.raw = text;
    if (text) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) results.parsed = JSON.parse(match[0]);
    }
  } catch(e: unknown) { results.error = e instanceof Error ? e.message : String(e); }

  return NextResponse.json(results);
}
