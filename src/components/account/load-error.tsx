'use client';

// The error state of a signed-in page (M08 final check, requirements-2; plan §5.6: every area has
// an error state with a retry). Shown inside the root layout, so the app shell, the navigation and
// the theme stay, never Next.js's bare default screen. It says calmly that nothing was changed (the
// page only reads) and never shows the error itself.
//
// Two ways in:
//   - `retryHref`: the page caught the failure of its own read (a database timeout, say) and renders
//     this on the server. "Try again" is a link to the same address, so it works without
//     JavaScript (the browser asks for the page again); with JavaScript it refreshes the page in
//     place (router.refresh()), and the page replaces this state once the read works.
//   - `retry`: an error.tsx boundary for anything else, with the boundary's retry() (a button; the
//     boundary exists only with JavaScript).
// A link leads somewhere else in the meantime.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { AlertIcon, ArrowLeftIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';

export function LoadError({
  eyebrow,
  title,
  message,
  retry,
  retryHref,
  back,
}: {
  eyebrow: string;
  /** The page's own heading, so the reader still knows where they are. */
  title: string;
  /** What could not be loaded, and that nothing was changed. */
  message: string;
  back: { href: string; label: string };
} & ({ retry: () => void; retryHref?: undefined } | { retryHref: string; retry?: undefined })) {
  const router = useRouter();
  const [pending, startRetry] = useTransition();
  const again = () => {
    if (pending) return;
    startRetry(() => (retry ? retry() : router.refresh()));
  };
  const label = pending ? 'Trying again…' : 'Try again';
  const retryClass = buttonVariants({ variant: 'secondary' });
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid max-w-[46rem] content-start gap-5">
        <header>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-2 font-display text-feature">{title}</h1>
        </header>
        <div role="alert" data-testid="load-error" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-4">
          <p className="flex items-start gap-2 text-ui font-semibold">
            <AlertIcon size={18} className="mt-1 shrink-0 text-danger" />
            <span>{message}</span>
          </p>
          <p className="max-w-[56ch] text-sm text-fg-muted">This is usually brief: try again in a moment.</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {retryHref ? (
              <a
                href={retryHref}
                data-testid="load-error-retry"
                aria-disabled={pending || undefined}
                onClick={(event) => {
                  event.preventDefault();
                  again();
                }}
                className={retryClass}
              >
                {label}
              </a>
            ) : (
              <button type="button" data-testid="load-error-retry" aria-disabled={pending || undefined} onClick={again} className={retryClass}>
                {label}
              </button>
            )}
            <Link href={back.href} className="link inline-flex min-h-11 items-center gap-1.5 text-ui">
              <ArrowLeftIcon size={18} />
              {back.label}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
