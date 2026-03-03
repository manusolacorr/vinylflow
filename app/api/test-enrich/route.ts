import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const results: Record<string, unknown> = {};

  // Get token
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const { access_token } = await tokenRes.json();

  // Search for track
  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=Dancing+In+Outer+Space+Atmosfear&type=track&limit=1`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  const searchData = await searchRes.json();
  const track = searchData?.tracks?.items?.[0];
  results.track = { name: track?.name, artist: track?.artists?.[0]?.name, id: track?.id };

  // Try audio-features (403 expected)
  const featRes = await fetch(`https://api.spotify.com/v1/audio-features/${track?.id}`,
    { headers: { Authorization: `Bearer ${access_token}` } });
  results.audio_features_status = featRes.status;

  // Try recommendations (includes tempo/key in seed response)
  const recRes = await fetch(
    `https://api.spotify.com/v1/recommendations?seed_tracks=${track?.id}&limit=1`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  results.recommendations_status = recRes.status;
  if (recRes.ok) {
    const recData = await recRes.json();
    results.recommendations_sample = recData?.tracks?.[0]?.name;
  }

  // Try track endpoint — sometimes includes tempo in preview
  const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${track?.id}`,
    { headers: { Authorization: `Bearer ${access_token}` } });
  const trackData = await trackRes.json();
  results.track_fields = Object.keys(trackData);

  // Try audio-analysis (different from audio-features)
  const analysisRes = await fetch(`https://api.spotify.com/v1/audio-analysis/${track?.id}`,
    { headers: { Authorization: `Bearer ${access_token}` } });
  results.audio_analysis_status = analysisRes.status;
  if (analysisRes.ok) {
    const analysisData = await analysisRes.json();
    results.analysis_tempo = analysisData?.track?.tempo;
    results.analysis_key   = analysisData?.track?.key;
    results.analysis_mode  = analysisData?.track?.mode;
  }

  return NextResponse.json(results);
}
