import { NextRequest, NextResponse } from 'next/server';
import { enrichTrack } from '@/lib/geminiLookup';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  try {
    const { artist, title, genres = [], styles = [] } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });
    const result = await enrichTrack(artist, title, genres, styles);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[enrich]', err);
    return NextResponse.json({ bpm: null, key: null, source: 'error', confidence: 'low', correction: null });
  }
}
