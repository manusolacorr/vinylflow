import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with only this JSON: {"bpm":120,"key":"8A"}' }] }],
          generationConfig: { maxOutputTokens: 30, temperature: 0 },
        }),
        signal: AbortSignal.timeout(8000),
      }
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ ok: false, status: res.status, error: data?.error?.message, keyPrefix: key.slice(0,12) });
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return NextResponse.json({ ok: true, raw: text, keyPrefix: key.slice(0,12) });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
