import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'no key' });

  const prompt = `You are an expert DJ and music analyst with deep knowledge of electronic music, soul, funk, disco and jazz records.

Identify the musical key of this specific track: "Frits Wentink - Horses In Cornfield"
Genre: Electronic, Deep House
BPM is 123.

Respond ONLY with: {"key": "11A"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    const raw = data?.content?.[0]?.text ?? '';
    return NextResponse.json({ ok: res.ok, status: res.status, raw, model: 'claude-sonnet-4-6' });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
