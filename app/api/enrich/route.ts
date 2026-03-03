/**
 * POST /api/enrich
 * Body: { artist: string, title: string }
 * Returns: { bpm: number | null, key: string | null, source: string }
 *
 * Sources:
 *  1. Claude AI (primary — knows BPM/key from training data)
 *  2. Spotify (if available)
 *  3. GetSongBPM (fallback)
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const CAM_KEYS = ['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
                  '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B'];

// ── Source 1: Claude AI ───────────────────────────────────────────────────
async function tryClaude(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `What is the BPM and musical key of "${title}" by ${artist}?
Reply ONLY with a JSON object like: {"bpm": 124, "key": "8A"}
- bpm: integer beats per minute, or null if unknown
- key: Camelot notation (e.g. "8A", "11B"), or null if unknown
No explanation, just the JSON.`
        }]
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim() || '';

    // Parse JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);

    const bpm = parsed.bpm && typeof parsed.bpm === 'number' ? Math.round(parsed.bpm) : null;
    const key = parsed.key && CAM_KEYS.includes(parsed.key) ? parsed.key : null;

    if (!bpm && !key) return null;
    return { bpm, key };
  } catch { return null; }
}

// ── Source 2: Spotify ─────────────────────────────────────────────────────
const SPOTIFY_TO_CAMELOT: Record<string, string> = {
  '0_1':'8B','0_0':'5A','1_1':'3B','1_0':'12A','2_1':'10B','2_0':'7A',
  '3_1':'5B','3_0':'2A','4_1':'12B','4_0':'9A','5_1':'7B','5_0':'4A',
  '6_1':'2B','6_0':'11A','7_1':'9B','7_0':'6A','8_1':'4B','8_0':'1A',
  '9_1':'11B','9_0':'8A','10_1':'6B','10_0':'3A','11_1':'1B','11_0':'10A',
};
let spotifyToken: string | null = null;
let spotifyExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyToken && Date.now() < spotifyExpiry) return spotifyToken;
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
      body: 'grant_type=client_credentials', signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    spotifyToken = d.access_token; spotifyExpiry = Date.now() + (d.expires_in - 60) * 1000;
    return spotifyToken;
  } catch { return null; }
}

async function trySpotify(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  const token = await getSpotifyToken(); if (!token) return null;
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const sr = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=3`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    if (!sr.ok) return null;
    const sd = await sr.json(); const tracks = sd?.tracks?.items || [];
    if (!tracks.length) return null;
    const fr = await fetch(`https://api.spotify.com/v1/audio-features/${tracks[0].id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    if (!fr.ok) return null; // 403 for restricted apps
    const f = await fr.json();
    const bpm = f.tempo ? Math.round(f.tempo) : null;
    const key = (f.key !== undefined && f.mode !== undefined) ? SPOTIFY_TO_CAMELOT[`${f.key}_${f.mode}`] || null : null;
    return (bpm || key) ? { bpm, key } : null;
  } catch { return null; }
}

// ── Source 3: GetSongBPM ──────────────────────────────────────────────────
const OPEN_KEY_MAP: Record<string, string> = {
  '1m':'1A','1d':'1B','2m':'2A','2d':'2B','3m':'3A','3d':'3B','4m':'4A','4d':'4B',
  '5m':'5A','5d':'5B','6m':'6A','6d':'6B','7m':'7A','7d':'7B','8m':'8A','8d':'8B',
  '9m':'9A','9d':'9B','10m':'10A','10d':'10B','11m':'11A','11d':'11B','12m':'12A','12d':'12B',
};
async function tryGetSongBPM(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  const apiKey = process.env.GETSONGBPM_API_KEY; if (!apiKey) return null;
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const r = await fetch(`https://api.getsong.co/search/?api_key=${apiKey}&type=song&lookup=${q}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json(); const songs = Array.isArray(d.search) ? d.search : [];
    if (!songs.length) return null;
    const bpm = songs[0].tempo ? parseInt(songs[0].tempo) : null;
    const key = songs[0].open_key ? (OPEN_KEY_MAP[songs[0].open_key] || null) : null;
    return (bpm || key) ? { bpm, key } : null;
  } catch { return null; }
}

// ── Handler ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { artist, title } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });

    const claude = await tryClaude(artist, title);
    if (claude?.bpm || claude?.key) return NextResponse.json({ ...claude, source: 'claude' });

    const spotify = await trySpotify(artist, title);
    if (spotify?.bpm || spotify?.key) return NextResponse.json({ ...spotify, source: 'spotify' });

    const gsbpm = await tryGetSongBPM(artist, title);
    if (gsbpm?.bpm || gsbpm?.key) return NextResponse.json({ ...gsbpm, source: 'getsongbpm' });

    return NextResponse.json({ bpm: null, key: null, source: 'none' });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
