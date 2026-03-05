import { NextRequest, NextResponse } from 'next/server';
import { enrichTrack } from '@/lib/enrichment';
import { findSnippet } from '@/lib/snippetSources';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

export async function POST(req: NextRequest) {
  try {
    const { artist, title, genres = [], styles = [], catno } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });

    // Run shop search + Claude enrichment in parallel
    const [snippet, enriched] = await Promise.allSettled([
      findSnippet(artist, title, catno),
      enrichTrack(artist, title, genres, styles),
    ]);

    const shop = snippet.status === 'fulfilled' ? snippet.value : null;
    const ai   = enriched.status === 'fulfilled' ? enriched.value : null;

    // Merge: shop BPM wins (real data), AI key as fallback if no audio URL found
    const bpm       = shop?.bpm ?? ai?.bpm ?? null;
    const key       = ai?.key ?? null; // key comes from client-side audio analysis or AI
    const audioUrl  = shop?.audioUrl ?? null;
    const source    = shop?.found
      ? `${shop.source}${ai ? '+claude' : ''}`
      : (ai?.source ?? 'not_found');

    return NextResponse.json({
      bpm,
      key,
      audioUrl,   // client will fetch this and analyse key
      source,
      confidence: ai?.confidence ?? (bpm ? 'high' : 'low'),
      correction: ai?.correction ?? null,
    });
  } catch (err) {
    console.error('[enrich]', err);
    return NextResponse.json({ bpm: null, key: null, audioUrl: null, source: 'error', confidence: 'low', correction: null });
  }
}
