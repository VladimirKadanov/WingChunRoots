'use client';

// A school's logo and room photos for the account that listed it (milestone M16;
// docs/adr/0019-galleries.md): "Add logo"/"Change logo" and "Remove logo"; "Add a room photo" (up
// to the room gallery's limit, DEFAULT D07), each room photo's caption, "Move up"/"Move down" and
// "Remove". The calls go to the schoolPhotos.* procedures through /api/rpc (plan §6.8), as the
// person gallery's controls (./gallery-manager.tsx), with the same keyboard, touch and status rules.

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { PHOTO_ACCEPT } from '@/components/lineage/photo-control';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import type { GalleryPhotoDto } from '@/server/dto/gallery';
import type { SchoolPhotosView } from '@/server/services/school-photos';
import { CaptionForm } from './gallery-manager';
import { photoAlt } from './gallery-grid';
import { callRpc, MAX_BYTES, MAX_MB, messageOf, type Status, StatusLine, uploadRpc } from './rpc';

function FilePicker({
  id,
  label,
  disabled,
  hint,
  onFile,
  testId,
  inputRef,
}: {
  id: string;
  label: string;
  disabled: boolean;
  hint: string;
  onFile: (file: File) => void;
  testId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={PHOTO_ACCEPT}
          aria-describedby={`${id}-hint`}
          aria-disabled={disabled || undefined}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onFile(file);
            event.currentTarget.value = '';
          }}
          data-testid={testId}
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          className={cx(
            buttonVariants({ variant: 'secondary' }),
            'cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
            disabled && 'cursor-not-allowed opacity-70',
          )}
        >
          {label}
        </label>
      </div>
      <p id={`${id}-hint`} className="max-w-[60ch] text-sm text-fg-muted">
        {hint}
      </p>
    </div>
  );
}

export function SchoolPhotosManager({ view, schoolName }: { view: SchoolPhotosView; schoolName: string }) {
  const id = useId();
  const router = useRouter();
  const logoPicker = useRef<HTMLInputElement>(null);
  const roomPicker = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  // The order shown: the server's, or the one just chosen while it saves (adjusted while rendering).
  const [shown, setShown] = useState<{ from: readonly GalleryPhotoDto[]; rooms: GalleryPhotoDto[] }>({ from: view.rooms, rooms: view.rooms });
  if (shown.from !== view.rooms) setShown({ from: view.rooms, rooms: view.rooms });
  const rooms = shown.from === view.rooms ? shown.rooms : view.rooms;
  const setRooms = (next: GalleryPhotoDto[]) => setShown({ from: view.rooms, rooms: next });
  const focusAfter = useRef<string | null>(null);
  const busy = status.kind === 'busy';
  const full = rooms.length >= view.limit;

  useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [rooms]);

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

  function upload(kind: 'logo' | 'room', file: File) {
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'refused', text: `This file is larger than ${MAX_MB} MB. Choose a smaller copy.` });
      return;
    }
    void run(
      kind === 'logo' ? 'Uploading the logo…' : 'Uploading the photo…',
      kind === 'logo' ? (view.logo ? 'Logo changed.' : 'Logo added.') : 'Photo added.',
      () => uploadRpc('/api/rpc/schoolPhotos/upload', { schoolId: view.schoolId, kind }, file),
    );
  }

  function move(index: number, step: -1 | 1) {
    const next = [...rooms];
    const [moved] = next.splice(index, 1);
    next.splice(index + step, 0, moved!);
    const target = index + step;
    const button = step < 0 && target > 0 ? 'up' : step > 0 && target < next.length - 1 ? 'down' : step < 0 ? 'down' : 'up';
    focusAfter.current = `${id}-${moved!.id}-${button}`;
    const before = rooms;
    setRooms(next);
    void run(
      'Saving the order…',
      `Moved to place ${target + 1} of ${next.length}.`,
      () => callRpc('/api/rpc/schoolPhotos/reorder', { schoolId: view.schoolId, photoIds: next.map((p) => p.id) }),
      undefined,
      () => setRooms(before),
    );
  }

  return (
    <div className="grid gap-8" data-testid="school-photos-manager">
      <StatusLine status={status} testId="school-photos-status" />
      <section aria-labelledby={`${id}-logo`} className="grid gap-3">
        <h2 id={`${id}-logo`} className="font-display text-xl">
          Logo
        </h2>
        {view.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={view.logo.large}
            alt={`Logo of ${schoolName}`}
            width={96}
            height={96}
            className="size-24 rounded-sm border border-border-subtle bg-surface-1 object-contain"
            data-testid="school-logo-preview"
          />
        ) : (
          <p className="text-fg-muted">No logo yet.</p>
        )}
        <FilePicker
          id={`${id}-logo-file`}
          inputRef={logoPicker}
          label={view.logo ? 'Change logo' : 'Add logo'}
          disabled={busy}
          hint={`JPEG, PNG or WebP, up to ${MAX_MB} MB, at least 96 pixels on its longer side. The whole logo is kept, on a transparent square.`}
          onFile={(file) => upload('logo', file)}
          testId="school-logo-input"
        />
        {view.logo ? (
          <div>
            <button
              type="button"
              aria-disabled={busy || undefined}
              className={buttonVariants({ variant: 'ghost' })}
              data-testid="school-logo-remove"
              onClick={() =>
                void run('Removing the logo…', 'Logo removed.', () => callRpc('/api/rpc/schoolPhotos/remove', { photoId: view.logo!.id }), () => logoPicker.current?.focus())
              }
            >
              Remove logo
            </button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`${id}-rooms`} className="grid gap-3">
        <h2 id={`${id}-rooms`} className="font-display text-xl">
          Photos of the rooms
        </h2>
        <p className="text-ui" data-testid="school-rooms-count">
          {`${rooms.length} of ${view.limit} photos.`}
        </p>
        <FilePicker
          id={`${id}-room-file`}
          inputRef={roomPicker}
          label="Add a room photo"
          disabled={busy || full}
          hint={full ? `The gallery holds up to ${view.limit} photos. Remove one to add another.` : `JPEG, PNG or WebP, up to ${MAX_MB} MB. Its location and camera details are removed.`}
          onFile={(file) => upload('room', file)}
          testId="school-room-input"
        />
        {rooms.length > 0 ? (
          <ol className="grid gap-4" aria-label="Photos of the rooms, in their order">
            {rooms.map((photo, index) => (
              <li key={photo.id} className="grid gap-3 border-t border-border-subtle pt-4 sm:grid-cols-[8rem_minmax(0,1fr)]" data-testid="school-room-item" data-photo={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.large}
                  alt={photoAlt(photo, schoolName, index, rooms.length)}
                  width={128}
                  height={128}
                  loading="lazy"
                  className="size-32 rounded-sm border border-border-strong bg-surface-2 object-cover"
                />
                <div className="grid content-start gap-2">
                  <p className="text-sm font-semibold">{`Photo ${index + 1} of ${rooms.length}`}</p>
                  <CaptionForm
                    key={`${photo.id}:${photo.caption ?? ''}`}
                    photo={photo}
                    busy={busy}
                    onSave={(caption) =>
                      run('Saving the caption…', caption ? 'Caption saved.' : 'Caption removed.', () => callRpc('/api/rpc/schoolPhotos/update', { photoId: photo.id, caption }))
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    {index > 0 ? (
                      <button id={`${id}-${photo.id}-up`} type="button" aria-disabled={busy || undefined} className={buttonVariants({ variant: 'ghost' })} onClick={() => !busy && move(index, -1)}>
                        Move up
                      </button>
                    ) : null}
                    {index < rooms.length - 1 ? (
                      <button id={`${id}-${photo.id}-down`} type="button" aria-disabled={busy || undefined} className={buttonVariants({ variant: 'ghost' })} onClick={() => !busy && move(index, 1)}>
                        Move down
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-disabled={busy || undefined}
                      className={buttonVariants({ variant: 'ghost' })}
                      data-testid="school-room-remove"
                      onClick={() => void run('Removing the photo…', 'Photo removed.', () => callRpc('/api/rpc/schoolPhotos/remove', { photoId: photo.id }), () => roomPicker.current?.focus())}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}
