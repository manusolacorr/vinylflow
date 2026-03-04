import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' });

  // Try both API versions and a few model names
  const candidates = [
    'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-001:generateContent',
    'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-001:generateContent',
  ];

  const results: Record<string, string> = {};

  for (const url of candidates) {
    try {
      const res = await fetch(`${url}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with only: {"bpm":120,"key":"8A"}' }] }],
          generationConfig: { maxOutputTokens: 30 },
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (res.ok) {
        results[url] = 'OK: ' + JSON.stringify(data?.candidates?.[0]?.content?.parts?.[0]?.text);
      } else {
        results[url] = `${res.status}: ${data?.error?.message?.slice(0, 80)}`;
      }
    } catch (e: unknown) {
      results[url] = 'TIMEOUT/ERR: ' + (e instanceof Error ? e.message.slice(0, 60) : String(e));
    }
  }

  return NextResponse.json({ keyPrefix: key.slice(0, 12), results });
}
