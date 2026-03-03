# vinyl.flow — Next.js

Intent-Based DJ Set Builder with Discogs OAuth.

## Quick Start

### 1. Register your Discogs application
Go to https://www.discogs.com/settings/developers -> Register your application
- Application name: vinyl.flow
- Homepage URL: http://localhost:3000
- Callback URL: http://localhost:3000/api/auth/callback

Copy your Consumer Key and Consumer Secret.

### 2. Set up environment variables
```
cp env.local.example .env.local
# Fill in DISCOGS_CONSUMER_KEY, DISCOGS_CONSUMER_SECRET, SESSION_SECRET
```

Generate a session secret:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Install and run
```
npm install
npm run dev
# Open http://localhost:3000
```

## OAuth Flow (3-step OAuth 1.0a)

```
User clicks "Connect with Discogs"
  -> GET /api/auth/login
       -> Gets temp token from Discogs
       -> Saves token secret in encrypted cookie
       -> Redirects to discogs.com/oauth/authorize

User clicks "Allow" on Discogs
  -> GET /api/auth/callback?oauth_token=...&oauth_verifier=...
       -> Exchanges for permanent access token
       -> Fetches user identity
       -> Saves to session, redirects to /dashboard

/dashboard  (server-protected, credentials never reach client)
  -> Client calls /api/collection (signed server-side)
```

## Project Structure

```
vinylflow/
+-- app/
|   +-- layout.tsx                Root layout
|   +-- globals.css               Design tokens
|   +-- page.tsx                  Landing / connect screen
|   +-- dashboard/page.tsx        Main app (auth-protected)
|   +-- api/
|       +-- auth/login/route.ts   OAuth Step 1
|       +-- auth/callback/route.ts OAuth Step 3
|       +-- auth/logout/route.ts  Destroy session
|       +-- collection/route.ts   Discogs collection proxy
+-- components/
|   +-- DashboardClient.tsx       Interactive client shell
+-- lib/
|   +-- oauth.ts                  OAuth 1.0a + discogsGet()
|   +-- session.ts                iron-session config + types
+-- middleware.ts                 Route protection
```

## Deploying to Vercel

```
npx vercel
```

Set env vars in Vercel dashboard. Update Discogs callback URL to:
https://yourdomain.com/api/auth/callback

## Next Steps — porting vinyl-flow-v10.html logic

Collection data is ready in DashboardClient. Port core logic into lib/vinylflow/:

1. lib/vinylflow/roles.ts    -- ROLES, autoRole(), assignRole(), roleOf()
2. lib/vinylflow/camelot.ts  -- CAM, camCompat(), bpmBridge()
3. lib/vinylflow/engine.ts   -- transitionScore(), engine1BuildSet(), engine2SortSet()
4. lib/vinylflow/helpers.ts  -- pitchDrift(), vinylSide(), sameSide(), decadeOf()
5. Build React set-builder UI in components/ using these utilities
