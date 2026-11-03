'use client';

// A gallery's grid and its viewer (milestone M16; docs/adr/0019-galleries.md): the photos of a
// person's gallery or of a school's rooms as a grid of square thumbnails, each a link to the whole
// photo, so without JavaScript a photo still opens (the browser shows the image). With JavaScript
// a link opens the viewer instead (./gallery-viewer.tsx, loaded on first use so it adds nothing to
// the page's first JavaScript): an in-page dialog, never a new window or a pop-up.
//
// Every photo has its alt text: the owner's caption, or "<name>, photo 2 of 5" without one. The
// links are 44 px and more on every screen; nothing is shown only on hover (the caption is under
// the photo in the viewer, and in the thumbnail's alt text).

import { lazy, Suspense, useState } from 'react';

import { cx } from '@/lib/cx';
import type { GalleryPhotoDto } from '@/server/dto/gallery';

const loadViewer = () => import('./gallery-viewer');
const GalleryViewer = lazy(loadViewer);

/** The alt text of a photo: its caption, or the subject's name and its place in the gallery. */
export function photoAlt(photo: Pick<GalleryPhotoDto, 'caption'>, name: string, index: number, count: number): string {
  return photo.caption ?? `${name}, photo ${index + 1} of ${count}`;
}

export function GalleryGrid({
  photos,
  name,
  label,
  testId = 'gallery-grid',
}: {
  photos: readonly GalleryPhotoDto[];
  /** Whose photos (a person's Latin display name, a school's name): the alt text without a caption. */
  name: string;
  /** The list's accessible name ("Photos of Demo Person"). */
  label: string;
  testId?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  if (photos.length === 0) return null;
  return (
    <>
      <ul aria-label={label} data-testid={testId} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <a
              href={photo.full}
              data-gallery-photo={photo.id}
              className={cx(
                'block aspect-square min-h-11 overflow-hidden rounded-sm border border-border-strong bg-surface-2',
                'outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus',
              )}
              onPointerEnter={() => void loadViewer()}
              onFocus={() => void loadViewer()}
              onClick={(event) => {
                // A new tab or window (a modifier, the middle button) still gets the image itself.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                setLoaded(true);
                setOpen(index);
              }}
            >
              {/* A plain <img>: the app serves the WebP renditions itself, already square. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.large}
                alt={photoAlt(photo, name, index, photos.length)}
                width={512}
                height={512}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </a>
          </li>
        ))}
      </ul>
      {loaded ? (
        <Suspense fallback={null}>
          <GalleryViewer photos={photos} name={name} index={open} onIndexChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
