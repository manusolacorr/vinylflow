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
  try {
    const data = await discogsGet(
      `/users/${session.user.username}/collection/folders/0/releases?per_page=${perPage}&page=${page}&sort=${sort}&sort_order=${sortOrder}`,
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
