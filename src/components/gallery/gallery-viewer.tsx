'use client';

// The viewer of a gallery (milestone M16; docs/adr/0019-galleries.md), loaded by ./gallery-grid.tsx
// on first use: the whole photo in an in-page dialog (Base UI, ../ui/dialog.tsx: the focus stays
// inside, Esc and the browser's Back close it, the focus goes back to the photo that opened it).
//
// Moving between photos works every way, none only by hover: the Previous and Next buttons (44 px,
// with their words for a screen reader), the arrow keys while the focus is inside the viewer
// (single keys only inside the component, WCAG 2.1.4), and a swipe on a touch screen. The position
// ("Photo 2 of 5") is the dialog's title, so it is read on every move; the caption is under the
// photo and is its alt text (the name and the position without one).

import { type PointerEvent, useRef } from 'react';

import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { cx } from '@/lib/cx';
import type { GalleryPhotoDto } from '@/server/dto/gallery';
import { photoAlt } from './gallery-grid';

/** How far a finger moves sideways before it counts as a swipe, in CSS px. */
const SWIPE_MIN = 48;

export default function GalleryViewer({
  photos,
  name,
  index,
  onIndexChange,
}: {
  photos: readonly GalleryPhotoDto[];
  name: string;
  /** The photo shown, or null while the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const count = photos.length;
  const current = index === null ? null : (photos[Math.min(index, count - 1)] ?? null);
  const at = index === null ? 0 : Math.min(index, count - 1);
  const go = (step: number) => {
    if (index === null || count < 2) return;
    onIndexChange((at + step + count) % count);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    start.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent) => {
    const from = start.current;
    start.current = null;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  return (
    <Dialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) onIndexChange(null);
      }}
      title={<span data-testid="gallery-viewer-title">{`Photo ${at + 1} of ${count}`}</span>}
      className="max-w-[min(64rem,100%)]"
    >
      {current ? (
        <div
          data-testid="gallery-viewer"
          className="grid gap-3"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              go(1);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              go(-1);
            }
          }}
        >
          <div className="grid place-items-center" style={{ touchAction: 'pan-y' }} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (start.current = null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.id}
              src={current.full}
              alt={photoAlt(current, name, at, count)}
              width={current.width}
              height={current.height}
              decoding="async"
              data-testid="gallery-viewer-image"
              className="h-auto max-h-[65dvh] w-auto max-w-full rounded-sm bg-surface-1 object-contain"
            />
          </div>
          {current.caption ? (
            <p className="text-base" data-testid="gallery-viewer-caption">
              {current.caption}
            </p>
          ) : null}
          {count > 1 ? (
            <div className="flex flex-wrap justify-between gap-3">
              <button type="button" className={cx(buttonVariants({ variant: 'secondary' }))} onClick={() => go(-1)} data-testid="gallery-previous">
                <ArrowLeftIcon />
                Previous
              </button>
              <button type="button" className={cx(buttonVariants({ variant: 'secondary' }))} onClick={() => go(1)} data-testid="gallery-next">
                Next
                <ArrowRightIcon />
              </button>
            </div>
          ) : null}
          <p className="text-sm text-fg-muted">{count > 1 ? 'Use the arrow keys or swipe to move between photos. Esc closes the viewer.' : 'Esc closes the viewer.'}</p>
        </div>
      ) : null}
    </Dialog>
  );
}
