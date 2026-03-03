/**
 * POST /api/enrich
 * Body: { artist: string, title: string }
 * Returns: { bpm: number | null, key: string | null, source: string }
 *
 * Sources:
 *  1. Spotify Audio Features (primary — excellent coverage)
 *  2. GetSongBPM (fallback)
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const UA = 'vinylflow/1.0 (https://vinylflow.vercel.app)';

// ── Spotify key → Camelot ─────────────────────────────────────────────────
// Spotify returns pitch class (0=C, 1=C#, ..., 11=B) + mode (0=minor, 1=major)
const SPOTIFY_TO_CAMELOT: Record<string, string> = {
  '0_1': '8B',  // C major
  '0_0': '5A',  // C minor
  '1_1': '3B',  // C# major
  '1_0': '12A', // C# minor
  '2_1': '10B', // D major
  '2_0': '7A',  // D minor
  '3_1': '5B',  // Eb major
  '3_0': '2A',  // Eb minor
  '4_1': '12B', // E major
  '4_0': '9A',  // E minor
  '5_1': '7B',  // F major
  '5_0': '4A',  // F minor
  '6_1': '2B',  // F# major
  '6_0': '11A', // F# minor
  '7_1': '9B',  // G major
  '7_0': '6A',  // G minor
  '8_1': '4B',  // Ab major
  '8_0': '1A',  // Ab minor
  '9_1': '11B', // A major
  '9_0': '8A',  // A minor
  '10_1': '6B', // Bb major
  '10_0': '3A', // Bb minor
  '11_1': '1B', // B major
  '11_0': '10A',// B minor
};

// ── Spotify client credentials token (cached in module scope) ─────────────
let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    spotifyToken = data.access_token;
    spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return spotifyToken;
  } catch { return null; }
}

async function trySpotify(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  const token = await getSpotifyToken();
  if (!token) return null;

  try {
    // Search for the track
    const q = encodeURIComponent(`track:${title} artist:${artist}`);
    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?q=${q}&type=track&limit=5`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const tracks = searchData?.tracks?.items || [];
    if (tracks.length === 0) {
      // Try looser search without field filters
      const q2 = encodeURIComponent(`${title} ${artist}`);
      const res2 = await fetch(
        `https://api.spotify.com/v1/search?q=${q2}&type=track&limit=5`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
      );
      if (!res2.ok) return null;
      const d2 = await res2.json();
      const t2 = d2?.tracks?.items || [];
      if (t2.length === 0) return null;
      tracks.push(...t2);
    }

    // Pick best match
    const artistLow = artist.toLowerCase().split(/[\s,&]+/)[0]; // first word of artist
    const titleLow  = title.toLowerCase();
    let bestId = tracks[0].id;
    for (const t of tracks) {
      const tTitle  = (t.name || '').toLowerCase();
      const tArtist = (t.artists?.[0]?.name || '').toLowerCase();
      if (tTitle.includes(titleLow.slice(0, 15)) && tArtist.includes(artistLow)) {
        bestId = t.id; break;
      }
    }

    // Get audio features
    const featRes = await fetch(
      `https://api.spotify.com/v1/audio-features/${bestId}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!featRes.ok) return null;
    const feat = await featRes.json();

    const bpm = feat.tempo ? Math.round(feat.tempo) : null;
    const camelot = (feat.key !== undefined && feat.mode !== undefined)
      ? SPOTIFY_TO_CAMELOT[`${feat.key}_${feat.mode}`] || null
      : null;

    if (!bpm && !camelot) return null;
    return { bpm, key: camelot };
  } catch { return null; }
}

// ── GetSongBPM fallback ───────────────────────────────────────────────────
const KEY_MAP: Record<string, string> = {
  '1m':'1A','1d':'1B','2m':'2A','2d':'2B','3m':'3A','3d':'3B',
  '4m':'4A','4d':'4B','5m':'5A','5d':'5B','6m':'6A','6d':'6B',
  '7m':'7A','7d':'7B','8m':'8A','8d':'8B','9m':'9A','9d':'9B',
  '10m':'10A','10d':'10B','11m':'11A','11d':'11B','12m':'12A','12d':'12B',
};

async function tryGetSongBPM(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  const apiKey = process.env.GETSONGBPM_API_KEY;
  if (!apiKey) return null;
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetch(
      `https://api.getsong.co/search/?api_key=${apiKey}&type=song&lookup=${q}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const songs = Array.isArray(data.search) ? data.search : [];
    if (songs.length === 0) return null;
    const best = songs[0];
    const bpm  = best.tempo ? parseInt(best.tempo) : null;
    const key  = best.open_key ? (KEY_MAP[best.open_key] || null) : null;
    return (bpm || key) ? { bpm, key } : null;
  } catch { return null; }
}

// ── Handler ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { artist, title } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'artist and title required' }, { status: 400 });

    const spotify = await trySpotify(artist, title);
    if (spotify?.bpm || spotify?.key) {
      return NextResponse.json({ bpm: spotify.bpm, key: spotify.key, source: 'spotify' });
    }

    const gsbpm = await tryGetSongBPM(artist, title);
    if (gsbpm?.bpm || gsbpm?.key) {
      return NextResponse.json({ bpm: gsbpm.bpm, key: gsbpm.key, source: 'getsongbpm' });
    }

    return NextResponse.json({ bpm: null, key: null, source: 'none' });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
