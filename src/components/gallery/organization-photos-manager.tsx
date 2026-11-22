'use client';

// An organization's logo and banner for its admins (ADR 0052): "Add"/"Change" and "Remove" for
// each. The calls go to the organizationPhotos.* procedures through /api/rpc (plan §6.8), with the
// same keyboard, touch and status rules as a school's photos (./school-photos-manager.tsx).

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';

import { LOGO_GROUND } from '@/components/ink/logo-ground';
import { buttonVariants } from '@/components/ui/button-variants';
import type { OrganizationPhotosView } from '@/server/services/organization-photos';
import { callRpc, MAX_BYTES, MAX_MB, messageOf, type Status, StatusLine, uploadRpc } from './rpc';
import { FilePicker } from './school-photos-manager';

export function OrganizationPhotosManager({ view, organizationName }: { view: OrganizationPhotosView; organizationName: string }) {
  const id = useId();
  const router = useRouter();
  const logoPicker = useRef<HTMLInputElement>(null);
  const bannerPicker = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const busy = status.kind === 'busy';

  async function run(busyText: string, doneText: string, call: () => Promise<Response>, after?: () => void) {
    if (busy) return;
    setStatus({ kind: 'busy', text: busyText });
    const outcome = await call().then(
      async (response) => (response.ok ? null : await messageOf(response, 'That did not work. Try again.')),
      () => 'The connection failed. Try again.',
    );
    if (outcome !== null) {
      setStatus({ kind: 'refused', text: outcome });
      router.refresh();
      return;
    }
    after?.();
    setStatus({ kind: 'done', text: doneText });
    router.refresh();
  }

  function upload(kind: 'logo' | 'banner', file: File) {
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'refused', text: `This file is larger than ${MAX_MB} MB. Choose a smaller copy.` });
      return;
    }
    const current = kind === 'logo' ? view.logo : view.banner;
    const word = kind === 'logo' ? 'Logo' : 'Banner';
    void run(`Uploading the ${kind}…`, current ? `${word} changed.` : `${word} added.`, () =>
      uploadRpc('/api/rpc/organizationPhotos/upload', { organizationId: view.organizationId, kind }, file),
    );
  }

  return (
    <div className="grid gap-8" data-testid="organization-photos-manager">
      <StatusLine status={status} testId="organization-photos-status" />
      <section aria-labelledby={`${id}-logo`} className="grid gap-3">
        <h2 id={`${id}-logo`} className="font-display text-xl">
          Logo
        </h2>
        {view.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={view.logo.large}
            alt={`Logo of ${organizationName}`}
            width={96}
            height={96}
            className="size-24 rounded-sm border border-border-subtle bg-surface-1 object-contain"
            style={LOGO_GROUND}
            data-testid="organization-logo-preview"
          />
        ) : (
          <p className="text-fg-muted">No logo yet: the page shows the organization’s initials.</p>
        )}
        <FilePicker
          id={`${id}-logo-file`}
          inputRef={logoPicker}
          label={view.logo ? 'Change logo' : 'Add logo'}
          disabled={busy}
          hint={`JPEG, PNG or WebP, up to ${MAX_MB} MB, at least 96 pixels on its longer side. The whole logo is kept, on a transparent square.`}
          onFile={(file) => upload('logo', file)}
          testId="organization-logo-input"
        />
        {view.logo ? (
          <div>
            <button
              type="button"
              aria-disabled={busy || undefined}
              className={buttonVariants({ variant: 'ghost' })}
              data-testid="organization-logo-remove"
              onClick={() =>
                void run('Removing the logo…', 'Logo removed.', () => callRpc('/api/rpc/organizationPhotos/remove', { photoId: view.logo!.id }), () => logoPicker.current?.focus())
              }
            >
              Remove logo
            </button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`${id}-banner`} className="grid gap-3">
        <h2 id={`${id}-banner`} className="font-display text-xl">
          Banner
        </h2>
        {view.banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={view.banner.full}
            alt={`Banner of ${organizationName}`}
            width={view.banner.width}
            height={view.banner.height}
            className="aspect-[16/5] w-full max-w-xl rounded-sm border border-border-subtle bg-surface-1 object-cover"
            data-testid="organization-banner-preview"
          />
        ) : (
          <p className="text-fg-muted">No banner yet: the page shows a drawing made from the organization’s address.</p>
        )}
        <FilePicker
          id={`${id}-banner-file`}
          inputRef={bannerPicker}
          label={view.banner ? 'Change banner' : 'Add banner'}
          disabled={busy}
          hint={`JPEG, PNG or WebP, up to ${MAX_MB} MB. A wide photo works best: the page crops it to a band across the top, so keep what matters in the middle.`}
          onFile={(file) => upload('banner', file)}
          testId="organization-banner-input"
        />
        {view.banner ? (
          <div>
            <button
              type="button"
              aria-disabled={busy || undefined}
              className={buttonVariants({ variant: 'ghost' })}
              data-testid="organization-banner-remove"
              onClick={() =>
                void run('Removing the banner…', 'Banner removed.', () => callRpc('/api/rpc/organizationPhotos/remove', { photoId: view.banner!.id }), () => bannerPicker.current?.focus())
              }
            >
              Remove banner
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
