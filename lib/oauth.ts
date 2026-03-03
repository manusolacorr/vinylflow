/**
 * lib/oauth.ts — Discogs OAuth 1.0a helpers
 *
 * 3-step handshake:
 *  1. GET /oauth/request_token  → temp token + secret
 *  2. Redirect user to discogs.com/oauth/authorize?oauth_token=...
 *  3. POST /oauth/access_token  → permanent token + secret
 */
import crypto from 'crypto';

const DISCOGS_API = 'https://api.discogs.com';
const DISCOGS_AUTH = 'https://www.discogs.com';
const USER_AGENT = 'vinylflow/1.0';

export interface RequestTokenResult {
  oauthToken: string;
  oauthTokenSecret: string;
  authorizeUrl: string;
}

export interface AccessTokenResult {
  oauthToken: string;
  oauthTokenSecret: string;
}

export interface DiscogsUser {
  id: number;
  username: string;
  avatar_url: string;
}

// ── Signature helpers ─────────────────────────────────────────────────────

function pct(s: string) {
  return encodeURIComponent(s)
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');
}

function buildAuthHeader(
  method: string,
  url: string,
  extraOAuth: Record<string,string>,
  consumerSecret: string,
  tokenSecret = '',
): string {
  const op: Record<string,string> = {
    oauth_consumer_key:     process.env.DISCOGS_CONSUMER_KEY!,
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now()/1000)),
    oauth_version:          '1.0',
    ...extraOAuth,
  };

  const baseParams = Object.keys(op).sort()
    .map(k => `${pct(k)}=${pct(op[k])}`).join('&');
  const baseStr = [method.toUpperCase(), pct(url), pct(baseParams)].join('&');
  const sigKey  = `${pct(consumerSecret)}&${pct(tokenSecret)}`;
  op.oauth_signature = crypto.createHmac('sha1', sigKey).update(baseStr).digest('base64');

  const parts = Object.keys(op).filter(k => k.startsWith('oauth_'))
    .map(k => `${pct(k)}="${pct(op[k])}"`).join(', ');
  return `OAuth ${parts}`;
}

// ── Step 1 ────────────────────────────────────────────────────────────────

export async function getRequestToken(): Promise<RequestTokenResult> {
  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`;
  const url = `${DISCOGS_API}/oauth/request_token`;
  const auth = buildAuthHeader('GET', url, { oauth_callback: callbackUrl },
    process.env.DISCOGS_CONSUMER_SECRET!);

  const res = await fetch(url, {
    headers: { Authorization: auth, 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`request_token failed: ${res.status} ${await res.text()}`);

  const p = new URLSearchParams(await res.text());
  const oauthToken       = p.get('oauth_token')!;
  const oauthTokenSecret = p.get('oauth_token_secret')!;
  return {
    oauthToken,
    oauthTokenSecret,
    authorizeUrl: `${DISCOGS_AUTH}/oauth/authorize?oauth_token=${oauthToken}`,
  };
}

// ── Step 3 ────────────────────────────────────────────────────────────────

export async function getAccessToken(
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string,
): Promise<AccessTokenResult> {
  const url = `${DISCOGS_API}/oauth/access_token`;
  const auth = buildAuthHeader('POST', url,
    { oauth_token: oauthToken, oauth_verifier: oauthVerifier },
    process.env.DISCOGS_CONSUMER_SECRET!, oauthTokenSecret);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'User-Agent': USER_AGENT,
               'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`access_token failed: ${res.status} ${await res.text()}`);

  const p = new URLSearchParams(await res.text());
  return { oauthToken: p.get('oauth_token')!, oauthTokenSecret: p.get('oauth_token_secret')! };
}

// ── Signed API helper ─────────────────────────────────────────────────────

export async function discogsGet<T = unknown>(
  path: string, accessToken: string, accessTokenSecret: string,
): Promise<T> {
  const url  = `${DISCOGS_API}${path}`;
  const auth = buildAuthHeader('GET', url, { oauth_token: accessToken },
    process.env.DISCOGS_CONSUMER_SECRET!, accessTokenSecret);

  const res = await fetch(url, {
    headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' },
    next: { revalidate: 60 },
  });

  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    return discogsGet(path, accessToken, accessTokenSecret);
  }
  if (!res.ok) throw new Error(`Discogs API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

// ── Identity helper ───────────────────────────────────────────────────────

export async function getDiscogsIdentity(
  accessToken: string, accessTokenSecret: string,
): Promise<DiscogsUser> {
  const id = await discogsGet<{ id: number; username: string }>(
    '/oauth/identity', accessToken, accessTokenSecret);
  const profile = await discogsGet<{ avatar_url: string }>(
    `/users/${id.username}`, accessToken, accessTokenSecret);
  return { id: id.id, username: id.username, avatar_url: profile.avatar_url };
}
