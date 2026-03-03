import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Test one track at a time via ?artist=X&title=Y for debugging
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || 'Harvey Mason';
  const title = searchParams.get('title') || 'How Does It Feel';
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: `Find the BPM and musical key of "${title}" by ${artist}. Search Tunebat, Beatport, Juno Download, or any music database. Try multiple searches if needed. Reply ONLY with JSON: {"bpm": 126, "key": "9B"} in Camelot notation. No other text.` }]
    }),
    signal: AbortSignal.timeout(55000),
  });

  const data = await res.json();
  const allText = (data?.content || [])
    .filter((b: {type:string}) => b.type === 'text')
    .map((b: {text:string}) => b.text)
    .join('\n');

  const toolUses = (data?.content || [])
    .filter((b: {type:string}) => b.type === 'tool_use')
    .map((b: {name:string; input:{query?:string}}) => b.input?.query);

  return NextResponse.json({
    artist, title,
    http_status: res.status,
    stop_reason: data?.stop_reason,
    searches_performed: toolUses,
    final_text: allText,
    usage: data?.usage,
  });
}
