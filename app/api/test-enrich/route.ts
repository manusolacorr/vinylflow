import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || 'Harvey Mason';
  const title  = searchParams.get('title')  || 'How Does It Feel';

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const results: Record<string, unknown> = {
    artist, title,
    spotify_client_id: clientId ? `${clientId.slice(0,6)}...` : 'MISSING',
  };

  try {
    // Get token
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(6000),
    });
    results.token_status = tokenRes.status;
    if (!tokenRes.ok) { results.token_error = await tokenRes.text(); return NextResponse.json(results); }
    const { access_token } = await tokenRes.json();
    results.token = 'OK';

    // Search
    const q = encodeURIComponent(`${title} ${artist}`);
    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?q=${q}&type=track&limit=3`,
      { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
    );
    results.search_status = searchRes.status;
    const searchData = await searchRes.json();
    const tracks = searchData?.tracks?.items || [];
    results.tracks_found = tracks.length;
    if (tracks.length === 0) { results.note = 'no tracks found'; return NextResponse.json(results); }

    results.first_match = { name: tracks[0].name, artist: tracks[0].artists?.[0]?.name, id: tracks[0].id };

    // Audio features
    const featRes = await fetch(
      `https://api.spotify.com/v1/audio-features/${tracks[0].id}`,
      { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
    );
    results.features_status = featRes.status;
    const feat = await featRes.json();
    results.tempo  = feat.tempo;
    results.key    = feat.key;
    results.mode   = feat.mode;
  } catch(e: unknown) {
    results.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(results);
}
