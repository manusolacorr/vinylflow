/**
 * GET /api/collection
 *
 * Two modes:
 *   ?mode=all   — fetches ALL pages server-side, returns { releases: [...], total }
 *   ?page=N     — returns a single page (legacy / sync use)
 *
 * Doing pagination server-side avoids multiple client→Vercel→Discogs round trips
 * which caused hangs on page 2 due to connection reuse issues.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { discogsGet } from '@/lib/oauth';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';

interface CollectionPage {
  releases: unknown[];
  pagination: { pages: number; page: number; items: number };
}

export async function GET(req: NextRequest) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);

  if (!session.user || !session.oauthAccessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get('mode');
  const page      = searchParams.get('page')       || '1';
  const perPage   = searchParams.get('per_page')   || '100';
  const sort      = searchParams.get('sort')       || 'added';
  const sortOrder = searchParams.get('sort_order') || 'desc';

  const base = `/users/${session.user.username}/collection/folders/0/releases`;
  const qs   = (p: number) => `${base}?per_page=${perPage}&page=${p}&sort=${sort}&sort_order=${sortOrder}`;

  try {
    if (mode === 'all') {
      // ── Fetch ALL pages server-side ───────────────────────────────────
      const first = await discogsGet<CollectionPage>(qs(1),
        session.oauthAccessToken, session.oauthAccessTokenSecret!);

      let releases = [...first.releases];
      const { pages } = first.pagination;

      for (let p = 2; p <= pages; p++) {
        // Small delay to respect Discogs rate limit (60 req/min)
        await new Promise(r => setTimeout(r, 500));
        const page = await discogsGet<CollectionPage>(qs(p),
          session.oauthAccessToken, session.oauthAccessTokenSecret!);
        releases = releases.concat(page.releases);
      }

      return NextResponse.json({ releases, total: releases.length });
    }

    // ── Single page (legacy) ──────────────────────────────────────────
    const data = await discogsGet(qs(Number(page)),
      session.oauthAccessToken, session.oauthAccessTokenSecret!);

    return NextResponse.json(data);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/collection]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
