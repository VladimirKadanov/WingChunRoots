'use client';

// The owner's gallery controls (milestone M16; docs/adr/0019-galleries.md) on /dashboard/photos:
// add a photo, write its caption, move it up or down, make it the profile photo, remove it. Every
// change goes to a gallery.* procedure through the web's /api/rpc (plan §6.8; /api/v1 is the
// mobile contract), the upload in oRPC's RPC multipart form as M14's photo control does
// (../lineage/photo-control.tsx); the server checks everything again (the owner, the allowance
// under its lock, the type by its magic bytes, the image encoded again without EXIF or GPS).
//
// Keyboard, touch and screen reader alike: real buttons and a real file input (its label drawn as
// a button, 44 px targets), the order changed with "Move up"/"Move down" (no drag and drop), the
// outcome in words in one polite status line (never by colour alone; a refusal also has the alert
// icon), and the focus kept on the moved photo's button or, after a removal, on the picker.

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { PHOTO_ACCEPT } from '@/components/lineage/photo-control';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import type { PersonGalleryPhotoDto } from '@/server/dto/gallery';
import type { GalleryView } from '@/server/services/gallery';
import { photoAlt } from './gallery-grid';
import { callRpc, CAPTION_MAX, MAX_BYTES, MAX_MB, messageOf, type Status, StatusLine, uploadRpc } from './rpc';

export function GalleryManager({ view }: { view: GalleryView }) {
  const id = useId();
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  // The order shown: the server's, or the one just chosen while it saves; a new answer of the server
  // (router.refresh) replaces it (state adjusted while rendering, not in an effect).
  const [shown, setShown] = useState<{ from: readonly PersonGalleryPhotoDto[]; photos: PersonGalleryPhotoDto[] }>({ from: view.photos, photos: view.photos });
  if (shown.from !== view.photos) setShown({ from: view.photos, photos: view.photos });
  const photos = shown.from === view.photos ? shown.photos : view.photos;
  const setPhotos = (next: PersonGalleryPhotoDto[]) => setShown({ from: view.photos, photos: next });
  const focusAfter = useRef<string | null>(null);
  const busy = status.kind === 'busy';
  const canAdd = view.allowance?.canAdd ?? false;

  useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [photos]);

  async function run(busyText: string, doneText: string, call: () => Promise<Response>, after?: () => void, undo?: () => void) {
    if (busy) return;
    setStatus({ kind: 'busy', text: busyText });
    const outcome = await call().then(
      async (response) => (response.ok ? null : await messageOf(response, 'That did not work. Try again.')),
      () => 'The connection failed. Try again.',
    );
    if (outcome !== null) {
      // A refused change shows what the server holds again (code review: a refused reorder kept
      // the order it had only drawn).
      undo?.();
      setStatus({ kind: 'refused', text: outcome });
      router.refresh();
      return;
    }
    after?.();
    setStatus({ kind: 'done', text: doneText });
    router.refresh();
  }

  function upload(file: File) {
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'refused', text: `This file is larger than ${MAX_MB} MB. Choose a smaller copy.` });
      return;
    }
    void run('Uploading the photo…', 'Photo added.', () => uploadRpc('/api/rpc/gallery/add', {}, file)).finally(() => {
      if (picker.current) picker.current.value = '';
    });
  }

  function move(index: number, step: -1 | 1) {
    const next = [...photos];
    const [moved] = next.splice(index, 1);
    next.splice(index + step, 0, moved!);
    // The focus stays on the moved photo's button in the same direction (or the other, at an end).
    const target = index + step;
    const button = step < 0 && target > 0 ? 'up' : step > 0 && target < next.length - 1 ? 'down' : step < 0 ? 'down' : 'up';
    focusAfter.current = `${id}-${moved!.id}-${button}`;
    const before = photos;
    setPhotos(next);
    void run(
      'Saving the order…',
      `Moved to place ${target + 1} of ${next.length}.`,
      () => callRpc('/api/rpc/gallery/reorder', { photoIds: next.map((p) => p.id) }),
      undefined,
      () => setPhotos(before),
    );
  }

  const inputId = `${id}-file`;
  const hintId = `${id}-hint`;
  return (
    <div className="grid gap-6" data-testid="gallery-manager">
      <section aria-labelledby={`${id}-add`} className="grid gap-2">
        <h2 id={`${id}-add`} className="font-display text-2xl">
          Add a photo
        </h2>
        {view.allowance ? (
          <p className="text-ui" data-testid="gallery-manager-allowance">
            {view.allowance.sentence}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={picker}
            id={inputId}
            type="file"
            accept={PHOTO_ACCEPT}
            aria-describedby={hintId}
            aria-disabled={busy || !canAdd || undefined}
            onClick={(event) => {
              if (busy || !canAdd) event.preventDefault();
            }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) upload(file);
            }}
            data-testid="gallery-input"
            className="peer sr-only"
          />
          <label
            htmlFor={inputId}
            className={cx(
              buttonVariants({ variant: 'secondary' }),
              'cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
              (busy || !canAdd) && 'cursor-not-allowed opacity-70',
            )}
          >
            Add photo
          </label>
        </div>
        <p id={hintId} className="max-w-[60ch] text-sm text-fg-muted">
          {canAdd
            ? `JPEG, PNG or WebP, up to ${MAX_MB} MB. Its location and camera details are removed. Your first photo becomes your profile photo.`
            : 'Your plan’s photos are all in use. Remove a photo to add another.'}
        </p>
        <StatusLine status={status} testId="gallery-status" />
      </section>

      <section aria-labelledby={`${id}-list`} className="grid gap-3">
        <h2 id={`${id}-list`} className="font-display text-2xl">
          Your gallery
        </h2>
        {photos.length === 0 ? (
          <p className="text-fg-muted">No photos yet. The cards in the lineage show your monogram until you add one.</p>
        ) : (
          <ol className="grid gap-4" aria-label="Your photos, in their order">
            {photos.map((photo, index) => (
              <li key={photo.id} className="grid gap-3 border-t border-border-subtle pt-4 sm:grid-cols-[8rem_minmax(0,1fr)]" data-testid="gallery-item" data-photo={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.large}
                  alt={photoAlt(photo, view.displayName, index, photos.length)}
                  width={128}
                  height={128}
                  loading="lazy"
                  className="size-32 rounded-sm border border-border-strong bg-surface-2 object-cover"
                />
                <div className="grid content-start gap-2">
                  <p className="text-sm font-semibold" data-testid="gallery-item-state">
                    {`Photo ${index + 1} of ${photos.length}`}
                    {photo.isProfile ? ' · Profile photo' : ''}
                  </p>
                  <CaptionForm
                    key={`${photo.id}:${photo.caption ?? ''}`}
                    photo={photo}
                    busy={busy}
                    onSave={(caption) =>
                      run('Saving the caption…', caption ? 'Caption saved.' : 'Caption removed.', () => callRpc('/api/rpc/gallery/update', { photoId: photo.id, caption }))
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    {index > 0 ? (
                      <button id={`${id}-${photo.id}-up`} type="button" aria-disabled={busy || undefined} className={buttonVariants({ variant: 'ghost' })} onClick={() => !busy && move(index, -1)}>
                        Move up
                      </button>
                    ) : null}
                    {index < photos.length - 1 ? (
                      <button id={`${id}-${photo.id}-down`} type="button" aria-disabled={busy || undefined} className={buttonVariants({ variant: 'ghost' })} onClick={() => !busy && move(index, 1)}>
                        Move down
                      </button>
                    ) : null}
                    {!photo.isProfile ? (
                      <button
                        type="button"
                        aria-disabled={busy || undefined}
                        className={buttonVariants({ variant: 'ghost' })}
                        data-testid="gallery-make-profile"
                        onClick={() => void run('Changing the profile photo…', 'Profile photo changed.', () => callRpc('/api/rpc/gallery/profile', { photoId: photo.id }))}
                      >
                        Use as profile photo
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-disabled={busy || undefined}
                      className={buttonVariants({ variant: 'ghost' })}
                      data-testid="gallery-remove"
                      onClick={() =>
                        void run(
                          'Removing the photo…',
                          photo.isProfile ? 'Photo removed. You have no profile photo now.' : 'Photo removed.',
                          () => callRpc('/api/rpc/gallery/remove', { photoId: photo.id }),
                          () => picker.current?.focus(),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** A photo's caption: a field and Save (Enter saves too). */
export function CaptionForm({ photo, busy, onSave }: { photo: { id: string; caption: string | null }; busy: boolean; onSave: (caption: string | null) => void }) {
  const id = useId();
  // A new caption from the server remounts the form (its key), so the field starts from it.
  const [value, setValue] = useState(photo.caption ?? '');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSave(value.trim() === '' ? null : value.trim());
      }}
    >
      <span className="grid min-w-0 flex-1 gap-1">
        <label htmlFor={`${id}-caption`} className="text-sm">
          Caption <span className="text-fg-muted">(optional; read aloud in place of the photo)</span>
        </label>
        <input
          id={`${id}-caption`}
          name="caption"
          value={value}
          maxLength={CAPTION_MAX}
          onChange={(event) => setValue(event.currentTarget.value)}
          className="min-h-11 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-3 text-base"
          data-testid="gallery-caption"
        />
      </span>
      <button type="submit" aria-disabled={busy || undefined} className={buttonVariants({ variant: 'secondary' })} data-testid="gallery-caption-save">
        Save caption
      </button>
    </form>
  );
}
