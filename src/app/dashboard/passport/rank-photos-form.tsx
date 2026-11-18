// "Photos on this rank" of /dashboard/passport (owner decision 2026-11-18, docs/adr/0046-passport-extras.md):
// up to three photos of the student's own gallery on one of their ranks, ticked in gallery order.
// A Server Component (no client module, so the page's JavaScript stays within its budget) posting
// to a thin Server Action over passport.setRankPhotos; the outcome comes back through the page
// (keepFormResult). Every target is at least 44 px, and the choice is a checkbox with its own
// label, never colour alone.

import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE, messageId } from '@/lib/form-state';
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
  const form = PASSPORT_RANK_PHOTOS_FORM;
  const error = initial?.status === 'error' ? (initial.fields?.photoIds ?? initial.message) : null;
  const hintId = `${form}-hint`;
  return (
    <form id={form} action={setRankPhotosAction.bind(null, IDLE)} noValidate className="grid gap-3 rounded-sm border border-border-strong p-4" data-testid="passport-rank-photos-form">
      {error ? (
        <p id={messageId(form)} role="alert" tabIndex={-1} className="text-ui text-danger" data-testid="passport-rank-photos-error">
          <span className="font-semibold">Not saved:</span> {error}
        </p>
      ) : null}
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
        <fieldset className="grid gap-2" aria-describedby={error ? `${hintId} ${messageId(form)}` : hintId}>
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
          <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
            Save photos
          </button>
        ) : null}
        <Link href={`/dashboard/passport#entry-${id}`} className="link inline-flex min-h-11 items-center">
          Cancel
        </Link>
      </div>
    </form>
  );
}
