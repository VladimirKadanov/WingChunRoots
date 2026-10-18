'use client';

// The error state of a lineage section (plan §5.6; milestone M04): a catchError boundary
// (next/error) around the part of a page that reads the lineage, so a failed read leaves the rest
// of the page working and offers Retry, which fetches the section again (retry() re-renders the
// server components inside it). The message never shows the error itself.

import { catchError, type ErrorInfo } from 'next/error';

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';

function LineageErrorFallback({ what }: { what: string }, { retry }: ErrorInfo) {
  return (
    <div role="alert" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-4">
      <p className="flex items-start gap-2 text-ui font-semibold">
        <AlertIcon size={18} className="mt-0.5 text-danger" />
        <span>The {what} could not be loaded.</span>
      </p>
      <p className="max-w-[56ch] text-sm text-fg-muted">
        Nothing was changed. This is usually brief: try again, and the rest of the page keeps working meanwhile.
      </p>
      <button type="button" onClick={() => retry()} className={buttonVariants({ variant: 'secondary' })}>
        Retry
      </button>
    </div>
  );
}

/** Wraps a lineage section: `what` names it in the message ("teachers and students"). */
export const LineageBoundary = catchError(LineageErrorFallback);
