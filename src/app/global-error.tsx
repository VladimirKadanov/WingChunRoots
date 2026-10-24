'use client';

// The last error boundary (milestone M04 fix round 1): when the root layout itself fails, Next.js
// renders this document instead of its built-in, unthemed screen. It brings its own <html> and
// <body>, the global styles and the theme script, so it follows the reader's theme like every
// page. The message never shows the error itself; Retry fetches the page again, and the home link
// is an ordinary link (an <a> in the HTML), so it works without JavaScript.

import Link from 'next/link';

import { fontFaceClassNames } from '@/design/fonts';
import { THEME_SCRIPT } from '@/design/theme';
import './globals.css';

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={fontFaceClassNames} suppressHydrationWarning>
      <head>
        <title>Something went wrong · WingChunRoots</title>
        <meta name="robots" content="noindex" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <main className="mx-auto grid min-h-dvh max-w-content content-center gap-5 px-page py-12">
          <p className="eyebrow">WingChunRoots</p>
          <h1 className="max-w-[18ch] font-display text-section">This page could not be shown</h1>
          <div role="alert" className="grid max-w-[40rem] justify-items-start gap-3 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-4">
            <p className="text-ui font-semibold">Something went wrong on our side.</p>
            <p className="max-w-[56ch] text-sm text-fg-muted">This is usually brief: try again in a moment.</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => retry()}
                className="inline-flex min-h-11 items-center rounded-sm border border-border-strong px-4 font-semibold text-fg hover:bg-surface-3"
              >
                Retry
              </button>
              <Link href="/" className="link inline-flex min-h-11 items-center px-2 text-ui">
                Back to Explore
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
