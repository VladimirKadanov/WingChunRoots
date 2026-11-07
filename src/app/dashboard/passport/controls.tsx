'use client';

// The controls of /dashboard/passport (milestone M19, In scope 5 and 7): "Make private" / "Make
// public" on each entry (passport.setVisibility, a thin Server Action that also works without
// JavaScript), the certificate upload and its removal (passport.uploadCertificate and
// passport.removeCertificate through the web's /api/rpc, as a gallery photo; the server checks the
// type by its magic bytes and encodes the image again without its metadata). Outcomes are words in
// a polite status line, never colour alone; every target is at least 44 px.

import { useRouter } from 'next/navigation';
import { useActionState, useId, useRef, useState } from 'react';

import { fieldClassName } from '@/components/account/fields';
import { MAX_BYTES, MAX_MB, messageOf, type Status, StatusLine, callRpc, uploadRpc } from '@/components/gallery/rpc';
import { PHOTO_ACCEPT } from '@/components/lineage/photo-control';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { type FormState, IDLE } from '@/lib/form-state';
import { setVisibilityAction } from './actions';

/** One entry's "Make private" / "Make public". */
export function VisibilityForm({ kind, id, visibility, initial }: { kind: string; id: string; visibility: 'private' | 'public'; initial: FormState | null }) {
  const [state, action, pending] = useActionState(setVisibilityAction, initial ?? IDLE);
  const next = visibility === 'public' ? 'private' : 'public';
  return (
    <form action={action} className="grid gap-1" data-testid="passport-visibility-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="visibility" value={next} />
      <div>
        <button
          type="submit"
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
          className={buttonVariants({ variant: 'secondary' })}
          data-testid={next === 'private' ? 'passport-make-private' : 'passport-make-public'}
        >
          {pending ? 'Saving…' : next === 'private' ? 'Make private' : 'Make public'}
        </button>
      </div>
      {state.status === 'error' && state.message ? (
        <p role="status" className="text-sm text-danger">
          <span className="font-semibold">Not changed:</span> {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** "Upload a certificate": the image, an optional title and date, private unless chosen public. */
export function CertificateUpload({ count, limit }: { count: number; limit: number }) {
  const id = useId();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const busy = status.kind === 'busy';
  const full = count >= limit;

  async function submit(form: HTMLFormElement) {
    if (busy || full) return;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setStatus({ kind: 'refused', text: 'Choose a JPEG, PNG or WebP image of the certificate.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'refused', text: `This file is larger than ${MAX_MB} MB. Choose a smaller copy.` });
      return;
    }
    setStatus({ kind: 'busy', text: 'Uploading the certificate…' });
    const fields = {
      title: String(data.get('title') ?? '') || null,
      date: String(data.get('date') ?? '') || null,
      visibility: data.get('visibility') === 'public' ? 'public' : 'private',
    };
    const outcome = await uploadRpc('/api/rpc/passport/certificate/upload', fields, file).then(
      async (response) => (response.ok ? null : await messageOf(response, 'That did not work. Try again.')),
      () => 'The connection failed. Try again.',
    );
    if (outcome !== null) {
      setStatus({ kind: 'refused', text: outcome });
      return;
    }
    form.reset();
    setStatus({ kind: 'done', text: fields.visibility === 'public' ? 'Certificate added. Your profile shows it.' : 'Certificate added. Only you and your teachers see it.' });
    router.refresh();
  }

  return (
    <form
      ref={formRef}
      noValidate
      className="grid gap-3"
      data-testid="certificate-upload"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <p className="text-ui" data-testid="certificate-allowance">
        {count} of {limit} certificates.
      </p>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-file`} className="text-sm font-semibold">
          Scan or photo of the certificate
        </label>
        <input
          id={`${id}-file`}
          name="file"
          type="file"
          accept={PHOTO_ACCEPT}
          aria-describedby={`${id}-file-hint`}
          disabled={full}
          data-testid="certificate-input"
          className={cx(fieldClassName, 'py-2.5 file:mr-3 file:min-h-9 file:rounded-sm file:border file:border-border-strong file:bg-surface-1 file:px-3')}
        />
        <p id={`${id}-file-hint`} className="max-w-[60ch] text-sm text-fg-muted">
          {full
            ? 'All your certificates are in use. Remove one to add another.'
            : `JPEG, PNG or WebP, up to ${MAX_MB} MB; no PDF. Its location and camera details are removed. It stays a scanned document: this platform does not issue or check certificates.`}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-title`} className="text-sm font-semibold">
            Title <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <input id={`${id}-title`} name="title" type="text" maxLength={200} autoComplete="off" className={fieldClassName} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-date`} className="text-sm font-semibold">
            Date issued <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <input id={`${id}-date`} name="date" type="text" inputMode="numeric" maxLength={10} autoComplete="off" aria-describedby={`${id}-date-hint`} className={fieldClassName} />
          <p id={`${id}-date-hint`} className="text-sm text-fg-muted">
            A year (2019), a month (2019-05) or a day (2019-05-12).
          </p>
        </div>
      </div>
      <fieldset className="grid gap-1">
        <legend className="text-sm font-semibold">Who sees it</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-ui">
          <input type="radio" name="visibility" value="private" defaultChecked className="size-5" />
          Private: only you and your teachers
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-ui">
          <input type="radio" name="visibility" value="public" className="size-5" />
          Public: shown on your profile where your plan shows certificates
        </label>
      </fieldset>
      <div>
        <button type="submit" aria-disabled={busy || full || undefined} className={buttonVariants({ variant: 'secondary', size: 'lg' })} data-testid="certificate-submit">
          {busy ? 'Uploading…' : 'Upload the certificate'}
        </button>
      </div>
      <StatusLine status={status} testId="certificate-status" />
    </form>
  );
}

/** "Remove the certificate": its files are deleted, the record of it kept. */
export function RemoveCertificateButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const busy = status.kind === 'busy';
  return (
    <div className="grid gap-1">
      <div>
        <button
          type="button"
          aria-disabled={busy || undefined}
          className={buttonVariants({ variant: 'ghost' })}
          data-testid="certificate-remove"
          onClick={async () => {
            if (busy) return;
            setStatus({ kind: 'busy', text: 'Removing the certificate…' });
            const outcome = await callRpc('/api/rpc/passport/certificate/remove', { id }).then(
              async (response) => (response.ok ? null : await messageOf(response, 'That did not work. Try again.')),
              () => 'The connection failed. Try again.',
            );
            if (outcome !== null) setStatus({ kind: 'refused', text: outcome });
            else {
              setStatus({ kind: 'done', text: 'Certificate removed.' });
              router.refresh();
            }
          }}
        >
          Remove<span className="sr-only"> the certificate “{title}”</span>
        </button>
      </div>
      {status.kind !== 'idle' ? <StatusLine status={status} testId="certificate-remove-status" /> : null}
    </div>
  );
}
