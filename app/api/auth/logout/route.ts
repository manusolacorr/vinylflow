/**
 * GET /api/auth/logout
 * Destroys the session cookie and redirects to home.
 */
import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';

export async function GET() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.destroy();
  return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL!);
}
