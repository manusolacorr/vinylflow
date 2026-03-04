import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'no key' });

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { maxOutputTokens: 80, temperature: 0.1 },
    });
    const result = await model.generateContent('Return this JSON exactly: {"bpm": 120, "key": "8A", "is_estimate": false}');
    const text = result.response.text();
    return NextResponse.json({ ok: true, raw: text, keyPrefix: key.slice(0, 12) });
  } catch (e: unknown) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      keyPrefix: key.slice(0, 12),
    });
  }
}
