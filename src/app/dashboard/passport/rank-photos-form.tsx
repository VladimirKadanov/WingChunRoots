'use client';

// "Photos on this rank" of /dashboard/passport (owner decision 2026-11-18, docs/adr/0046-passport-extras.md):
// up to three photos of the student's own gallery on one of their ranks, ticked in gallery order.
// A thin Server Action over passport.setRankPhotos that also works without JavaScript; every
// target is at least 44 px, and the choice is a checkbox with its own label, never colour alone.

import Link from 'next/link';
import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { type FormState, IDLE } from '@/lib/form-state';
import { setRankPhotosAction } from './actions';
import { PASSPORT_RANK_PHOTOS_FORM } from './form-ids';

export interface RankPhotoChoice {
  id: string;
  small: string;
  caption: string | null;
}

export function RankPhotosForm({
  id,
  title,
  gallery,
  chosen,
  limit,
  initial,
}: {
  id: string;
  title: string;
  gallery: readonly RankPhotoChoice[];
  chosen: readonly string[];
  limit: number;
  initial: FormState | null;
}) {
  const [state, action, pending] = useActionState(setRankPhotosAction, initial ?? IDLE);
  const form = PASSPORT_RANK_PHOTOS_FORM;
  useFocusOnError(form, state);
  const hintId = `${form}-hint`;
  return (
    <form id={form} action={action} noValidate className="grid gap-3 rounded-sm border border-border-strong p-4" data-testid="passport-rank-photos-form">
      <FormMessage form={form} state={state} labels={{ photoIds: 'Photos' }} />
      <input type="hidden" name="id" value={id} />
      {gallery.length === 0 ? (
        <p className="text-ui text-fg-muted" data-testid="passport-rank-photos-empty">
          Your gallery has no photos yet.{' '}
          <Link href="/dashboard/photos" className="link">
            Add photos to your gallery
          </Link>{' '}
          first, then choose them here.
        </p>
      ) : (
        <fieldset className="grid gap-2" aria-describedby={hintId}>
          <legend className="text-sm font-semibold">Photos on “{title}”</legend>
          <p id={hintId} className="text-sm text-fg-muted">
            Choose up to {limit} photos of your gallery, such as your grading day. They are shown with this rank wherever your passport is shown.
          </p>
          <ul className="flex flex-wrap gap-3">
            {gallery.map((photo, index) => (
              <li key={photo.id}>
                <label className="grid cursor-pointer justify-items-start gap-1 text-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.small}
                    alt={photo.caption ?? `Gallery photo ${index + 1}`}
                    width={96}
                    height={96}
                    loading="lazy"
                    decoding="async"
                    className="size-24 rounded-sm border border-border-subtle object-cover"
                  />
                  <span className="inline-flex min-h-11 items-center gap-2">
                    <input type="checkbox" name="photoId" value={photo.id} defaultChecked={chosen.includes(photo.id)} className="size-5" data-testid="passport-rank-photo-choice" />
                    Show
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {gallery.length > 0 ? (
          <SubmitButton pending={pending} pendingLabel="Saving…" variant="secondary">
            Save photos
          </SubmitButton>
        ) : null}
        <Link href={`/dashboard/passport#entry-${id}`} className="link inline-flex min-h-11 items-center">
          Cancel
        </Link>
      </div>
    </form>
  );
}
