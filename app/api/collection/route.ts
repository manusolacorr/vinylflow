/**
 * GET /api/collection?page=1
 *
 * Returns the authenticated user's Discogs collection for the given page.
 * Auth check: redirects to login if session is missing.
 *
 * This is a thin proxy — it forwards the request to Discogs using the
 * stored OAuth credentials, so the consumer key/secret never reach the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { discogsGet } from '@/lib/oauth';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);

  if (!session.user || !session.oauthAccessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page      = searchParams.get('page')       || '1';
  const perPage   = searchParams.get('per_page')   || '100';
  const sort      = searchParams.get('sort')       || 'added';
  const sortOrder = searchParams.get('sort_order') || 'desc';
  // date_added is included in the Discogs response automatically when sort=added

  try {
    const data = await discogsGet(
      `/users/${session.user.username}/collection/folders/0/releases` +
      `?per_page=${perPage}&page=${page}&sort=${sort}&sort_order=${sortOrder}`,
      session.oauthAccessToken,
      session.oauthAccessTokenSecret!,
    );

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/collection]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
