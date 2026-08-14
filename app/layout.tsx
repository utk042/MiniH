import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import { currentProfile } from '../lib/data/session';
import { isSupabaseConfigured } from '../lib/supabase/env';
import './globals.css';

const serif = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BACKSTACK',
  description: 'A peer-to-peer textbook exchange for one campus. Demand-first, swap-first.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const profile = await currentProfile();

  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Header profile={profile} />
        {!isSupabaseConfigured() && (
          <div className="shell" style={{ paddingTop: 'var(--space-3)' }}>
            <p className="eyebrow" style={{ color: 'var(--stamp-dark)' }}>
              Notice board — no database configured. Copy .env.example to .env.local to bring this up for real.
            </p>
          </div>
        )}
        <main id="main-content">
          <div className="shell">{children}</div>
        </main>
      </body>
    </html>
  );
}
