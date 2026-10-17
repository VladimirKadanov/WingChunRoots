// The app shell (plan §5.8 (b)): a top bar and bottom tabs on phones, a side rail from 768 px.
// It pads every edge with env(safe-area-inset-*) (viewport-fit=cover), sizes with dvh, keeps
// every control at least 44x44 px and needs no hover. Server component; only the nav links
// and the theme menu hydrate.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand/brand-mark';
import { NavLinks } from './nav-links';
import { ThemeMenu } from './theme-menu';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[var(--rail-w)_minmax(0,1fr)]">
      <a
        href="#main"
        className="fixed top-[calc(env(safe-area-inset-top,0px)+0.5rem)] left-[max(1rem,env(safe-area-inset-left,0px))] z-[100] inline-flex min-h-11 -translate-y-[200%] items-center rounded-sm bg-fg px-4 font-semibold text-fg-inverse focus-visible:translate-y-0"
      >
        Skip to content
      </a>

      {/* Phone: top bar. */}
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg pt-[env(safe-area-inset-top,0px)] md:hidden">
        <div className="flex h-(--top-h) items-center justify-between gap-2 pr-[max(0.375rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
          <Link href="/" className="inline-flex min-h-11 items-center" aria-label="WingChunRoots, home">
            <BrandMark />
          </Link>
          <ThemeMenu variant="icon" />
        </div>
      </header>

      {/* Phone: bottom tabs. Desktop: the side rail (its border runs the full page height). */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-bg/[0.975] backdrop-blur-lg md:static md:border-t-0 md:border-r md:bg-bg md:backdrop-blur-none"
      >
        <div className="flex h-[calc(var(--tab-h)+env(safe-area-inset-bottom,0px))] pr-[max(0.25rem,env(safe-area-inset-right,0px))] pb-[env(safe-area-inset-bottom,0px)] pl-[max(0.25rem,env(safe-area-inset-left,0px))] md:sticky md:top-0 md:h-dvh md:flex-col md:px-3.5 md:pt-6 md:pb-[max(1.125rem,env(safe-area-inset-bottom,0px))] md:pl-[max(0.875rem,env(safe-area-inset-left,0px))]">
          <Link href="/" className="mb-7 hidden min-h-11 items-center px-2 md:inline-flex" aria-label="WingChunRoots, home">
            <BrandMark />
          </Link>
          <div className="flex flex-1 md:hidden">
            <NavLinks variant="tabs" />
          </div>
          <div className="hidden md:block">
            <NavLinks variant="rail" />
          </div>
          <div className="mt-auto hidden flex-col gap-3.5 px-2 md:flex">
            <ThemeMenu variant="row" />
            <p className="text-[0.75rem] leading-[1.45] text-fg-subtle">Demo data: fictional people and schools.</p>
          </div>
        </div>
      </nav>

      <div className="min-w-0 pb-[calc(var(--tab-h)+env(safe-area-inset-bottom,0px))] md:pb-0">
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
