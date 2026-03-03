'use client';
/**
 * components/DashboardClient.tsx
 *
 * The main interactive app. This is the entry point for porting
 * the vinyl.flow v10 logic from the single HTML file into React.
 *
 * Currently shows a skeleton with:
 *  - Header with user info + logout
 *  - "Load Collection" button that calls /api/collection
 *  - Basic collection stats once loaded
 *
 * TODO: Port the full set-builder UI from vinyl-flow-v10.html into
 * React components here. The core logic (Camelot, engines, roles)
 * lives in lib/vinylflow/ once extracted.
 */

import { useState } from 'react';

interface User {
  id: number;
  username: string;
  avatar_url: string;
}

interface CollectionPage {
  pagination: { pages: number; items: number; page: number };
  releases: Array<{
    id: number;
    basic_information: {
      id: number;
      title: string;
      artists: Array<{ name: string }>;
      genres: string[];
      styles: string[];
      year: number;
      thumb: string;
    };
  }>;
}

export default function DashboardClient({ user }: { user: User }) {
  const [loading, setLoading]     = useState(false);
  const [loadMsg, setLoadMsg]     = useState('');
  const [totalItems, setTotal]    = useState<number | null>(null);
  const [releases, setReleases]   = useState<CollectionPage['releases']>([]);
  const [error, setError]         = useState('');

  async function loadCollection() {
    setLoading(true);
    setError('');
    setLoadMsg('Connecting to Discogs...');

    try {
      // Fetch page 1 to get total count
      const res = await fetch('/api/collection?page=1&per_page=100');
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/'; return; }
        throw new Error(`HTTP ${res.status}`);
      }
      const data: CollectionPage = await res.json();
      const { pages, items } = data.pagination;
      setTotal(items);
      setLoadMsg(`Loading page 1 of ${pages}...`);

      let all = [...data.releases];

      // Fetch remaining pages
      for (let p = 2; p <= pages; p++) {
        setLoadMsg(`Loading page ${p} of ${pages}...`);
        const r = await fetch(`/api/collection?page=${p}&per_page=100`);
        if (!r.ok) throw new Error(`Page ${p} failed: HTTP ${r.status}`);
        const d: CollectionPage = await r.json();
        all = [...all, ...d.releases];
        // Be gentle with Discogs rate limits
        await new Promise(res => setTimeout(res, 150));
      }

      setReleases(all);
      setLoadMsg('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load collection: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 1.2rem',
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)' }}>vinyl.flow</h1>
          {totalItems !== null && (
            <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
              · {releases.length} releases loaded
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          {user.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar_url} alt={user.username}
              style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
          )}
          <span style={{ fontSize: '0.75rem', color: 'var(--text)', fontWeight: 500 }}>
            {user.username}
          </span>
          <a href="/api/auth/logout" style={{
            fontSize: '0.7rem', color: 'var(--muted)', padding: '0.2rem 0.5rem',
            border: '1px solid var(--border)', borderRadius: 5,
          }}>
            Log out
          </a>
        </div>
      </header>

      {/* Body */}
      <main style={{ flex: 1, padding: '2rem', maxWidth: 900, margin: '0 auto', width: '100%' }}>

        {/* Error */}
        {error && (
          <div style={{
            background: '#fff5f5', border: '1px solid var(--red)',
            borderRadius: 7, padding: '0.6rem 0.8rem', marginBottom: '1rem',
            fontSize: '0.75rem', color: 'var(--red)',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Load prompt */}
        {!loading && releases.length === 0 && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '1.5rem', maxWidth: 480,
          }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              Load your collection
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.7, marginBottom: '1rem' }}>
              Fetches all releases from your Discogs collection. Large libraries
              may take a few minutes — tracklist data is fetched per release.
            </p>
            <button
              onClick={loadCollection}
              style={{
                background: 'var(--accent)', color: '#fff', borderRadius: 7,
                padding: '0.5rem 1rem', fontWeight: 600, fontSize: '0.8rem',
              }}
            >
              Load Collection
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.8rem' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)',
              animation: 'pulse 1s infinite',
            }} />
            {loadMsg}
          </div>
        )}

        {/* Collection loaded — basic stats */}
        {!loading && releases.length > 0 && (
          <div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.5rem', marginBottom: '1.5rem',
            }}>
              {[
                { label: 'Releases', value: releases.length },
                { label: 'Total tracks', value: releases.reduce((a, r) => a + 1, 0) },
                {
                  label: 'Genres',
                  value: new Set(releases.flatMap(r => r.basic_information.genres)).size
                },
                {
                  label: 'Styles',
                  value: new Set(releases.flatMap(r => r.basic_information.styles)).size
                },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '0.8rem 1rem',
                }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent)' }}>{value}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Placeholder for full set builder */}
            <div style={{
              background: 'var(--surface)', border: '2px dashed var(--border)',
              borderRadius: 10, padding: '2rem', textAlign: 'center', color: 'var(--muted)',
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🎛️</div>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                Set Builder — Coming Next
              </p>
              <p style={{ fontSize: '0.72rem', lineHeight: 1.6 }}>
                The full set-builder UI (roles, filters, harmonic engine, pitch drift,
                sticker guide) is being ported from vinyl-flow-v10.html into
                React components. Collection data is ready to use.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
