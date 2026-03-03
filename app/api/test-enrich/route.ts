import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const results: Record<string, unknown> = {
    has_id: !!clientId,
    has_secret: !!clientSecret,
    id_preview: clientId?.slice(0, 6),
  };

  // Get token
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  results.token_status = tokenRes.status;
  const tokenData = await tokenRes.json();
  results.token_data = tokenData;
  if (!tokenData.access_token) return NextResponse.json(results);

  const token = tokenData.access_token;

  // Simple search
  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=Atmosfear+Dancing+In+Outer+Space&type=track&limit=3`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  results.search_status = searchRes.status;
  const searchData = await searchRes.json();
  const tracks = searchData?.tracks?.items || [];
  results.tracks = tracks.map((t: {name:string; id:string; artists:{name:string}[]}) => ({
    name: t.name, id: t.id, artist: t.artists?.[0]?.name
  }));

  if (tracks.length > 0) {
    // Try audio-analysis
    const id = tracks[0].id;
    const aaRes = await fetch(`https://api.spotify.com/v1/audio-analysis/${id}`,
      { headers: { Authorization: `Bearer ${token}` } });
    results.audio_analysis_status = aaRes.status;
    if (aaRes.ok) {
      const aa = await aaRes.json();
      results.tempo = aa?.track?.tempo;
      results.key   = aa?.track?.key;
      results.mode  = aa?.track?.mode;
    }

    // Try audio-features
    const afRes = await fetch(`https://api.spotify.com/v1/audio-features/${id}`,
      { headers: { Authorization: `Bearer ${token}` } });
    results.audio_features_status = afRes.status;
    if (afRes.ok) {
      const af = await afRes.json();
      results.tempo_af = af?.tempo;
      results.key_af   = af?.key;
    }
  }

  return NextResponse.json(results);
}
