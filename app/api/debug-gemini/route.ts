import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' });

  // List all available models for this key
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data?.error?.message, keyPrefix: key.slice(0,12) });

    // Extract just the model names that support generateContent
    const models = (data.models || [])
      .filter((m: {supportedGenerationMethods?: string[]}) =>
        m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: {name: string}) => m.name);

    return NextResponse.json({ keyPrefix: key.slice(0,12), availableModels: models });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) });
  }
}
