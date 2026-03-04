import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: 'no ANTHROPIC_API_KEY' });

  try {
    const start = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [{ role: 'user', content: 'Return only this JSON: {"bpm":120,"key":"8A"}' }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const ms = Date.now() - start;
    if (!res.ok) return NextResponse.json({ ok: false, status: res.status, error: data });
    return NextResponse.json({ ok: true, ms, response: data?.content?.[0]?.text, keyPrefix: key.slice(0,8) + '...' });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
