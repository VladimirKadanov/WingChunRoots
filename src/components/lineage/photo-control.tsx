'use client';

// The owner's photo controls on their own profile (milestone M14; docs/adr/0016-profile-photos.md):
// "Add photo" or "Change photo" and "Remove photo". The picker is a real `<input type="file">`
// (visually hidden, its label drawn as the button), so it works with a keyboard (Tab, then Enter or
// Space opens the system picker), a screen reader, a phone's browser and a mobile webview, with no
// drag and drop needed. The file goes to the same API a native app uses (POST
// /api/v1/photos/upload, multipart `file`; POST /api/v1/photos/remove), which checks everything
// again: the size before the body is read, the type by its magic bytes, the image re-encoded
// without EXIF and GPS. The 5 MB check here only spares a long wait (DEFAULT D07).
//
// What happened is said in words in a polite status line, never by colour alone; a refusal also
// has the alert icon. The focus never falls to the page: after "Remove photo" (which disappears)
// it moves to the picker.

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';

export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_MB = 5;
const MAX_BYTES = MAX_MB * 1024 * 1024;

type Status = { kind: 'idle' | 'busy' | 'done' | 'refused'; text: string };

async function messageOf(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === 'string' && body.message ? body.message : fallback;
}

export function PhotoControl({ hasPhoto }: { hasPhoto: boolean }) {
  const id = useId();
  const inputId = `${id}-file`;
  const hintId = `${id}-hint`;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const busy = status.kind === 'busy';

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'refused', text: `This file is larger than ${MAX_MB} MB. Choose a smaller copy.` });
      return;
    }
    setStatus({ kind: 'busy', text: 'Uploading the photo…' });
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/v1/photos/upload', { method: 'POST', body: form, credentials: 'same-origin' });
      if (!response.ok) {
        setStatus({ kind: 'refused', text: await messageOf(response, 'The photo could not be uploaded. Try again.') });
        return;
      }
      setStatus({ kind: 'done', text: hasPhoto ? 'Photo changed.' : 'Photo added.' });
      router.refresh();
    } catch {
      setStatus({ kind: 'refused', text: 'The connection failed. Try again.' });
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (busy) return;
    setStatus({ kind: 'busy', text: 'Removing the photo…' });
    try {
      const response = await fetch('/api/v1/photos/remove', {
        method: 'POST',
        body: '{}',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) {
        setStatus({ kind: 'refused', text: await messageOf(response, 'The photo could not be removed. Try again.') });
        return;
      }
      // The button goes away with the photo: the focus moves to the picker, never to the page.
      input.current?.focus();
      setStatus({ kind: 'done', text: 'Photo removed.' });
      router.refresh();
    } catch {
      setStatus({ kind: 'refused', text: 'The connection failed. Try again.' });
    }
  }

  return (
    <div className="grid gap-2" data-testid="photo-control">
      <div className="flex flex-wrap items-center gap-2">
        {/* The input stays focusable while a photo uploads (aria-disabled), so the focus is kept. */}
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={PHOTO_ACCEPT}
          aria-describedby={hintId}
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void upload(file);
          }}
          data-testid="photo-input"
          className="peer sr-only"
        />
        <label
          htmlFor={inputId}
          className={cx(
            buttonVariants({ variant: 'secondary' }),
            'cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
            busy && 'cursor-wait',
          )}
        >
          {hasPhoto ? 'Change photo' : 'Add photo'}
        </label>
        {hasPhoto ? (
          <button
            type="button"
            onClick={() => void remove()}
            aria-disabled={busy || undefined}
            className={cx(buttonVariants({ variant: 'ghost' }))}
            data-testid="photo-remove"
          >
            Remove photo
          </button>
        ) : null}
      </div>
      <p id={hintId} className="text-sm text-fg-muted">
        JPEG, PNG or WebP, up to {MAX_MB} MB. It is cropped to a square, and its location and camera details are removed. Everyone who can see your profile sees it.
      </p>
      <p role="status" className={cx('text-sm', status.kind === 'refused' ? 'flex items-start gap-1.5 text-danger' : 'text-fg-muted')} data-testid="photo-status" data-state={status.kind}>
        {status.kind === 'refused' ? <AlertIcon size={16} className="mt-0.5 shrink-0" /> : null}
        {status.kind === 'refused' ? (
          <span>
            <span className="font-semibold">Not changed:</span> {status.text}
          </span>
        ) : (
          status.text
        )}
      </p>
    </div>
  );
}
