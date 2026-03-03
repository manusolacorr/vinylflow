/**
 * app/page.tsx — Landing page / Connect screen
 *
 * Shows error messages if OAuth failed, otherwise presents the
 * "Connect with Discogs" button that kicks off the OAuth flow.
 */
import { redirect } from 'next/navigation';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions } from '@/lib/session';
import type { SessionData } from '@/lib/session';

interface PageProps {
  searchParams: { error?: string };
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_init_failed:     'Could not start the Discogs authorisation. Please try again.',
  oauth_denied:          'You declined to connect Discogs. Click below to try again.',
  oauth_callback_failed: 'Something went wrong during authorisation. Please try again.',
  oauth_token_mismatch:  'Session mismatch. Please try again.',
};

export default async function HomePage({ searchParams }: PageProps) {
  // If already logged in, go straight to dashboard
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (session.user) redirect('/dashboard');

  const errorMsg = searchParams.error ? ERROR_MESSAGES[searchParams.error] : null;

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 440,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '2rem',
        boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
      }}>
        {/* Logo */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
            vinyl.flow
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 4 }}>
            Intent-Based DJ Set Builder
          </p>
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div style={{
            background: '#fff5f5',
            border: '1px solid var(--red)',
            borderRadius: 7,
            padding: '0.6rem 0.8rem',
            marginBottom: '1rem',
            fontSize: '0.75rem',
            color: 'var(--red)',
          }}>
            ⚠ {errorMsg}
          </div>
        )}

        {/* Description */}
        <p style={{ fontSize: '0.8rem', lineHeight: 1.7, color: 'var(--muted)', marginBottom: '1.5rem' }}>
          Connect your Discogs collection to build harmonically-mixed sets,
          get pitch drift warnings, and generate a printable sticker guide for gigs.
        </p>

        {/* OAuth button */}
        <a
          href="/api/auth/login"
          style={{
            display: 'block',
            width: '100%',
            padding: '0.7rem 1rem',
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 7,
            textAlign: 'center',
            fontWeight: 600,
            fontSize: '0.85rem',
            letterSpacing: '0.01em',
            transition: 'opacity 0.15s',
          }}
        >
          Connect with Discogs
        </a>

        <p style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.8rem', textAlign: 'center' }}>
          You&apos;ll be redirected to Discogs to authorise access.
          We never see your password.
        <p style={{ fontSize: '0.55rem', color: 'var(--muted)', marginTop: '1.5rem', textAlign: 'center' }}>
          BPM data powered by <a href="https://getsongbpm.com" style={{ color: 'var(--muted)' }}>GetSongBPM</a>
        </p>
      </div>
    </main>
  );
}
