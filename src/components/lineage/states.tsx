// Loading and empty states of the lineage screens (plan §5.6; milestone M04). The skeleton has
// the shape of the rows it stands for and never moves on its own; its text tells a screen reader
// what is loading. The empty state says what is missing in words, not with a blank space.

import { AlertIcon } from '@/components/icons';
import { LinkStroke } from '@/components/ink/link-stroke';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Rows of names with a line of detail and a badge, while a lineage section loads. Streamed
 * content replaces it only with JavaScript; `noScriptHref` names the page that works without
 * (the list view), for a browser that has it off.
 */
export function RelationsSkeleton({ what, rows = 3, noScriptHref }: { what: string; rows?: number; noScriptHref?: string }) {
  return (
    <div role="status" aria-busy="true" className="grid gap-8">
      <span className="sr-only">Loading {what}…</span>
      {noScriptHref ? (
        <noscript>
          <p className="text-ui">
            The {what} load with JavaScript, which is off in this browser.{' '}
            <a href={noScriptHref} className="link">
              The list view shows them without it
            </a>
            .
          </p>
        </noscript>
      ) : null}
      {[0, 1].map((section) => (
        <div key={section} className="grid gap-3 border-t border-border-subtle pt-6">
          <Skeleton className="h-7 w-40" />
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="grid gap-2 py-2">
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="h-4 w-72 max-w-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** "No teachers on the record yet": a dotted stroke and a sentence. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 text-ui text-fg-muted">
      <LinkStroke kind="unconfirmed" width={34} className="mt-1.5" />
      <p className="max-w-[56ch]">{children}</p>
    </div>
  );
}

/**
 * A section whose read failed, rendered on the server (the list view, which works without
 * JavaScript): the same words as the catchError fallback, and Retry is a link that loads the page
 * again. The message never shows the error itself.
 */
export function SectionError({ what, retryHref }: { what: string; retryHref: string }) {
  return (
    <div role="alert" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-4">
      <p className="flex items-start gap-2 text-ui font-semibold">
        <AlertIcon size={18} className="mt-0.5 text-danger" />
        <span>The {what} could not be loaded.</span>
      </p>
      <p className="max-w-[56ch] text-sm text-fg-muted">Nothing was changed. This is usually brief: try again, and the rest of the page keeps working meanwhile.</p>
      {/* A full reload, with or without JavaScript. */}
      <a href={retryHref} className={buttonVariants({ variant: 'secondary' })}>
        Retry
      </a>
    </div>
  );
}
