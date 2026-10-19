'use client';

// The error state of a lineage section (plan §5.6; milestone M04): a catchError boundary
// (next/error) around the part of a page that reads the lineage, so a failed read leaves the rest
// of the page working and offers Retry, which fetches the page's data again and re-renders the
// section (retry()). The message never shows the error itself. The error keeps the section's
// headings (`headings`), so the outline of the page stays the same.
//
// Focus after Retry (WCAG 2.4.3, 4.1.3): the button disappears with the error, so the reader's
// place moves to the section's first heading once it is back, and a status line says it loaded.
// A Retry that fails again moves focus to the new error, so it is announced again.

import { catchError, type ErrorInfo } from 'next/error';
import { useEffect, useRef } from 'react';

import { buttonVariants } from '@/components/ui/button-variants';
import { ErrorPanel, FailedSections, sectionErrorText } from './states';

/** Set when the reader pressed Retry, until the section (or its error) is back. */
let retrying = false;

function ErrorState({ what, error, retry }: { what: string; error: unknown; retry: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!retrying) return;
    retrying = false;
    panel.current?.focus();
  }, [error]);
  return (
    <ErrorPanel ref={panel} tabIndex={-1} title={sectionErrorText.title(what)}>
      <p className="max-w-[56ch] text-sm text-fg-muted">{sectionErrorText.body}</p>
      <button
        type="button"
        onClick={() => {
          retrying = true;
          retry();
        }}
        className={buttonVariants({ variant: 'secondary' })}
      >
        Retry
      </button>
    </ErrorPanel>
  );
}

interface BoundaryProps {
  /** Names the section in the message ("teachers and students"). */
  what: string;
  /** The section's headings: the error goes under the first, the others say they wait for it. */
  headings?: readonly { id: string; title: string }[];
}

function LineageErrorFallback({ what, headings = [] }: BoundaryProps, { error, retry }: ErrorInfo) {
  return (
    <FailedSections headings={headings}>
      <ErrorState what={what} error={error} retry={retry} />
    </FailedSections>
  );
}

/** Wraps a lineage section (see the file comment). */
export const LineageBoundary = catchError(LineageErrorFallback);

/**
 * Inside the section, once it rendered: after a Retry, focus its first heading (`targetId`, a
 * heading with tabIndex -1) and write `message` into the status line `statusId`.
 */
export function FocusAfterRetry({ targetId, statusId, message }: { targetId: string; statusId: string; message: string }) {
  useEffect(() => {
    if (!retrying) return;
    retrying = false;
    document.getElementById(targetId)?.focus();
    const status = document.getElementById(statusId);
    if (status) status.textContent = message;
  }, [targetId, statusId, message]);
  return null;
}
