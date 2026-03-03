/**
 * app/dashboard/page.tsx — Main app view (server component)
 *
 * Checks session — redirects to home if not authenticated.
 * Renders the DashboardClient component which handles all
 * interactive state (collection loading, set building, filters).
 */
import { redirect } from 'next/navigation';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';
import DashboardClient from '@/components/DashboardClient';

export default async function DashboardPage() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);

  if (!session.user) redirect('/');

  return <DashboardClient user={session.user} />;
}
