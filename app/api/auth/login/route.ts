/**
 * GET /api/auth/login — Step 1 of OAuth 1.0a
 * Gets a request token from Discogs, saves the secret in session,
 * then redirects the user to Discogs to authorise the app.
 */
import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { getRequestToken } from '@/lib/oauth';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { oauthToken, oauthTokenSecret, authorizeUrl } = await getRequestToken();

    const session = await getIronSession<SessionData>(cookies(), sessionOptions);
    session.oauthRequestToken       = oauthToken;
    session.oauthRequestTokenSecret = oauthTokenSecret;
    await session.save();

    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=oauth_init_failed`,
    );
  }
}
