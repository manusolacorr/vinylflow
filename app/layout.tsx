import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'vinyl.flow — Intent-Based DJ Set Builder',
  description: 'Build harmonic DJ sets from your Discogs collection.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
