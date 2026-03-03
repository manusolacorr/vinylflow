/**
 * middleware.ts
 *
 * Protects /dashboard and /api/* routes — redirects to / if no session.
 * Runs on the edge before any page renders.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';

const PROTECTED = ['/dashboard', '/api/collection'];

export async function middleware(req: NextRequest) {
  const isProtected = PROTECTED.some(p => req.nextUrl.pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);

  if (!session.user) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return res;
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/collection/:path*'],
};
