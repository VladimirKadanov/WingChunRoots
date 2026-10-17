// The app shell (plan §5.8 (b)): a top bar and bottom tabs on phones, a side rail from 768 px.
// It pads every edge with env(safe-area-inset-*) (viewport-fit=cover), sizes with dvh, keeps
// every control at least 44x44 px and needs no hover. Server component; only the nav links
// and the theme menu hydrate.

import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { BrandMark } from '@/components/brand/brand-mark';
import { DEMO_NOTICE } from './demo-notice';
import { FocusInView } from './focus-in-view';
import { NavLinks, NavList } from './nav-links';
import { TabBarRoom } from './tab-bar-room';
import { ThemeMenu } from './theme-menu';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[var(--rail-w)_minmax(0,1fr)]">
      {/* Hidden above the top edge, whatever the safe-area inset: in a full-screen webview the
          resting position must not include the inset, or part of the link shows in the status bar. */}
      <a
        href="#main"
        className="fixed top-0 left-[max(1rem,env(safe-area-inset-left,0px))] z-[100] inline-flex min-h-11 -translate-y-full items-center rounded-sm bg-fg px-4 font-semibold text-fg-inverse focus:translate-y-[calc(env(safe-area-inset-top,0px)+0.5rem)]"
      >
        Skip to content
      </a>

      {/* Phone: top bar. */}
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg pt-[env(safe-area-inset-top,0px)] md:hidden">
        <div className="flex min-h-(--top-h) items-center justify-between gap-2 pr-[max(0.375rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
          {/* min-w-0: at 200 % text the wordmark is cut, never the theme switch or the page. */}
          <Link href="/" className="inline-flex min-h-11 min-w-0 items-center" aria-label="WingChunRoots, home">
            <BrandMark className="min-w-0" />
          </Link>
          <ThemeMenu variant="icon" />
        </div>
      </header>

      {/* Phone: bottom tabs, at least var(--tab-h) tall with their 1 px top border and taller
          with larger text (TabBarRoom publishes the real height), above the home indicator, on a
          solid ground (no backdrop blur: it costs a compositing pass on every scroll frame in
          Android WebView). Desktop: the side rail (its border runs the full page height; it
          scrolls on its own when a landscape phone is too short for it). */}
      <nav
        aria-label="Main"
        data-tab-bar=""
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-bg md:static md:border-t-0 md:border-r"
      >
        <div className="flex min-h-[calc(var(--tab-h)-1px+env(safe-area-inset-bottom,0px))] pr-[max(0.25rem,env(safe-area-inset-right,0px))] pb-[env(safe-area-inset-bottom,0px)] pl-[max(0.25rem,env(safe-area-inset-left,0px))] md:sticky md:top-0 md:h-dvh md:min-h-0 md:flex-col md:overflow-y-auto md:overscroll-contain md:px-3.5 md:pt-[max(1.5rem,env(safe-area-inset-top,0px))] md:pb-[max(1.125rem,env(safe-area-inset-bottom,0px))] md:pl-[max(0.875rem,env(safe-area-inset-left,0px))]">
          <Link href="/" className="mb-7 hidden min-h-11 items-center px-2 md:inline-flex" aria-label="WingChunRoots, home">
            <BrandMark />
          </Link>
          <div className="flex flex-1 md:hidden">
            <Suspense fallback={<NavList variant="tabs" pathname={null} />}>
              <NavLinks variant="tabs" />
            </Suspense>
          </div>
          <div className="hidden md:block">
            <Suspense fallback={<NavList variant="rail" pathname={null} />}>
              <NavLinks variant="rail" />
            </Suspense>
          </div>
          <div className="mt-auto hidden flex-col gap-3.5 px-2 pt-6 md:flex">
            <ThemeMenu variant="row" />
            <p className="text-xs text-fg-subtle">{DEMO_NOTICE}</p>
          </div>
        </div>
        <TabBarRoom />
      </nav>

      {/* Clear of the tab bar or of an open non-modal sheet: below it (--page-clear-bottom,
          globals.css) or, from 1024 px, beside it (--sheet-page-inline: the side panel docks and
          the page narrows), so no page control is ever under a sheet (WCAG 2.4.11). */}
      <div className="min-w-0 pr-[var(--sheet-page-inline,0px)] pb-(--page-clear-bottom)">
        <FocusInView />
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
