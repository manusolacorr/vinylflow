/**
 * GET /api/auth/callback — Step 3 of OAuth 1.0a
 * Discogs redirects here with oauth_token + oauth_verifier.
 * We exchange these for a permanent access token, fetch the user's
 * identity, save everything in the session, and redirect to /dashboard.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { getAccessToken, getDiscogsIdentity } from '@/lib/oauth';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  try {
    const { searchParams } = new URL(req.url);
    const oauthToken    = searchParams.get('oauth_token');
    const oauthVerifier = searchParams.get('oauth_verifier');

    if (!oauthToken || !oauthVerifier) {
      // User denied authorisation on Discogs
      return NextResponse.redirect(`${appUrl}/?error=oauth_denied`);
    }

    const session = await getIronSession<SessionData>(cookies(), sessionOptions);

    // Verify the returned token matches what we stored
    if (session.oauthRequestToken !== oauthToken) {
      return NextResponse.redirect(`${appUrl}/?error=oauth_token_mismatch`);
    }

    // Exchange for permanent access token
    const { oauthToken: accessToken, oauthTokenSecret: accessTokenSecret } =
      await getAccessToken(oauthToken, session.oauthRequestTokenSecret!, oauthVerifier);

    // Fetch user identity
    const user = await getDiscogsIdentity(accessToken, accessTokenSecret);

    // Store permanent credentials + user in session; clear temp credentials
    session.oauthAccessToken       = accessToken;
    session.oauthAccessTokenSecret = accessTokenSecret;
    session.user                   = user;
    session.oauthRequestToken       = undefined;
    session.oauthRequestTokenSecret = undefined;
    await session.save();

    return NextResponse.redirect(`${appUrl}/dashboard`);
  } catch (err) {
    console.error('[auth/callback]', err);
    return NextResponse.redirect(`${appUrl}/?error=oauth_callback_failed`);
  }
}
