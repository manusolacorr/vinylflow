/**
 * GET /api/test-enrich?artist=Harvey+Mason&title=How+Does+It+Feel
 * Debug route — tests GetSongBPM directly and returns raw response
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || 'Harvey Mason';
  const title  = searchParams.get('title')  || 'How Does It Feel';
  const apiKey = process.env.GETSONGBPM_API_KEY;

  const results: Record<string, unknown> = { artist, title, apiKey: apiKey ? `${apiKey.slice(0,6)}...` : 'MISSING' };

  // Test 1: search endpoint
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const url = `https://api.getsong.co/search/?api_key=${apiKey}&type=song&lookup=${q}`;
    results.url = url.replace(apiKey||'x', 'KEY');
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    results.status = res.status;
    results.body = await res.json();
  } catch(e: unknown) {
    results.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(results, { status: 200 });
}
