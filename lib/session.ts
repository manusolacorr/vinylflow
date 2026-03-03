import type { IronSessionOptions } from 'iron-session';

export interface SessionData {
  // Temporary OAuth credentials (during handshake only)
  oauthRequestToken?: string;
  oauthRequestTokenSecret?: string;
  // Permanent credentials (after user authorises)
  oauthAccessToken?: string;
  oauthAccessTokenSecret?: string;
  // Discogs user info
  user?: { id: number; username: string; avatar_url: string; };
}

export const sessionOptions: IronSessionOptions = {
  cookieName: 'vinylflow_session',
  password: process.env.SESSION_SECRET as string,
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
};

declare module 'iron-session' {
  interface IronSessionData extends SessionData {}
}
