/**
 * GET /api/release/[id]
 * Fetches full tracklist + notes for a Discogs release.
 * Used to expand placeholder tracks into real A1/A2/B1/B2 entries.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { discogsGet } from '@/lib/oauth';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface DiscogsTrack {
  position: string;
  title: string;
  duration: string;
  type_: string;
  artists?: { name: string }[];
  extraartists?: { name: string; role: string }[];
}

interface DiscogsRelease {
  id: number;
  title: string;
  artists: { name: string }[];
  tracklist: DiscogsTrack[];
  notes?: string;
  genres?: string[];
  styles?: string[];
  year?: number;
  labels?: { name: string; catno: string }[];
  images?: { uri: string; type: string }[];
}

/** Parse BPM from Discogs notes field — DJs sometimes write it there */
function parseBpmFromNotes(notes: string): number | null {
  if (!notes) return null;
  const m = notes.match(/(\d{2,3})\s*bpm/i);
  return m ? parseInt(m[1]) : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.user || !session.oauthAccessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const release = await discogsGet<DiscogsRelease>(
      `/releases/${params.id}`,
      session.oauthAccessToken,
      session.oauthAccessTokenSecret!,
    );

    const notesBpm = parseBpmFromNotes(release.notes || '');
    const releaseArtist = (release.artists || [])
      .map(a => a.name.replace(/\s*\(\d+\)$/, '')).join(', ');

    // Filter to actual tracks (skip headings, index tracks)
    const tracks = (release.tracklist || [])
      .filter(t => t.type_ !== 'heading' && t.title && t.position)
      .map(t => ({
        position: t.position,
        title: t.title,
        duration: t.duration || '',
        artist: (t.artists || []).map(a => a.name.replace(/\s*\(\d+\)$/, '')).join(', ') || releaseArtist,
        notesBpm, // pass notes BPM down — may apply to all tracks on release
      }));

    return NextResponse.json({
      id: release.id,
      title: release.title,
      artist: releaseArtist,
      tracks,
      notesBpm,
      genres: release.genres || [],
      styles: release.styles || [],
      year: release.year || 0,
      thumb: release.images?.find(i => i.type === 'primary')?.uri
          || release.images?.[0]?.uri || null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    console.error('[api/release]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
