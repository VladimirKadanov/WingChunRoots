'use client';

// The calls of the gallery controls (milestone M16): the gallery.* and schoolPhotos.* procedures
// through the web's /api/rpc in oRPC's RPC form (plan §6.8), and the status line they share.

import type { ReactNode } from 'react';

import { AlertIcon } from '@/components/icons';
import { cx } from '@/lib/cx';

/** DEFAULT D07: an upload is at most 5 MB (the server checks again before reading the body). */
export const MAX_MB = 5;
export const MAX_BYTES = MAX_MB * 1024 * 1024;
/** The longest caption (PHOTO_CAPTION_MAX on the server). */
export const CAPTION_MAX = 200;

export type Status = { kind: 'idle' | 'busy' | 'done' | 'refused'; text: string };

/** The error's words: oRPC's RPC answer (`{ json: { message } }`) or the body check's (`{ message }`). */
export async function messageOf(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown; json?: { message?: unknown; data?: { fields?: Record<string, unknown> } } } | null;
  const message = body?.json?.message ?? body?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** A JSON procedure call: the input as oRPC's RPC body `{ json }`. */
export function callRpc(path: string, input: unknown): Promise<Response> {
  return fetch(path, { method: 'POST', body: JSON.stringify({ json: input }), credentials: 'same-origin', headers: { 'content-type': 'application/json' } });
}

/** A multipart call: the input's other fields in part `data`, the file in part `0` at `file`. */
export function uploadRpc(path: string, fields: Record<string, unknown>, file: File): Promise<Response> {
  const form = new FormData();
  form.set('data', JSON.stringify({ json: { ...fields, file: {} }, maps: [['file']] }));
  form.set('0', file);
  return fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
}

/** What happened, in words in a polite status line; a refusal also has the alert icon. */
export function StatusLine({ status, testId }: { status: Status; testId: string }): ReactNode {
  return (
    <p role="status" className={cx('text-sm', status.kind === 'refused' ? 'flex items-start gap-1.5 text-danger' : 'text-fg-muted')} data-testid={testId} data-state={status.kind}>
      {status.kind === 'refused' ? <AlertIcon size={16} className="mt-0.5 shrink-0" /> : null}
      {status.kind === 'refused' ? (
        <span>
          <span className="font-semibold">Not changed:</span> {status.text}
        </span>
      ) : (
        status.text
      )}
    </p>
  );
}
