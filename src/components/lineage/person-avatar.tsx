// A person's picture on a card (milestone M14; docs/adr/0016-profile-photos.md): the profile
// photo as a small round thumbnail, or, without one, the monogram seal the cards had before (the
// first letters of the Latin name in a small square). Plain markup with no client code, so it is
// server-rendered in the lists and costs the explorer nothing but an <img>.
//
// The image: the 96 px rendition for every card (sharp on a 2x screen at 48 px), the 512 px one on
// the profile; `width` and `height` always set, so nothing moves when it arrives (CLS);
// `loading="lazy"` on cards (the explorer draws only the nodes on screen, so only those load) and
// eager on the profile, where it is part of the first screen. `alt` is the person's Latin display
// name on the profile portrait and the review case; empty (`decorative`) wherever the name is
// next to it or names the surrounding element (list rows, school instructors, the explorer's
// cards, panel and students list, the search palette), so a screen reader does not read the name
// twice (M14 review). The monogram is always decorative (aria-hidden): the name is next to it.
//
// M16 (owner decision 2026-11-03, docs/adr/0019-galleries.md): on the explorer's full card the
// picture is no longer a small round thumbnail but a square on the card's leading edge whose side
// is the card's height (`card`: it fills the card's height, flush with its edge, a line between it
// and the text; the card clips its corners). The monogram stays in the same square. The lists,
// the panel, the search results and the profile keep their round thumbnails.

import { cx } from '@/lib/cx';
import type { PhotoDto } from '@/server/dto/public';
import { monogram } from './monogram';

const SIZES = {
  /** A small round thumbnail (M14's card size; kept for a caller that needs one). */
  xs: { px: 24, text: 'text-caption', square: false },
  /** A round thumbnail of 32 px. */
  sm: { px: 32, text: 'text-xs', square: false },
  /** A round thumbnail of 40 px. */
  md: { px: 40, text: 'text-sm', square: false },
  /** The profile's header, beside the name. */
  lg: { px: 96, text: 'text-3xl', square: false },
  /** M16: the explorer's full card, a square as high as the card (NODE_SIZES.full.height) on its leading edge. */
  card: { px: 64, text: 'text-xl', square: true },
} as const;

export type AvatarSize = keyof typeof SIZES;

export function PersonAvatar({
  name,
  photo,
  size = 'sm',
  decorative = false,
  className,
}: {
  /** The Latin display name: the image's alt text and the monogram's source. */
  name: string;
  photo?: PhotoDto | null;
  size?: AvatarSize;
  /**
   * Beside the visible name, or inside an element whose accessible name is already the person's
   * name, the image is hidden from assistive technology so the name is not read twice.
   */
  decorative?: boolean;
  className?: string;
}) {
  const { px, text, square } = SIZES[size];
  // M16: a card's square fills the card's height, flush with its leading edge (the card's own
  // border and rounded corners frame it), with a line between it and the text.
  const shape = square ? 'self-stretch rounded-none border-0 border-r' : 'rounded-full border';
  const box = square ? { height: '100%', width: 'auto', aspectRatio: '1 / 1' } : { width: px, height: px };
  if (photo) {
    return (
      // A plain <img>: the app serves the WebP renditions itself (GET /api/photos/...), already
      // square and small, so next/image would add a second resize and client code for nothing.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={size === 'lg' ? photo.large : photo.small}
        alt={decorative ? '' : name}
        aria-hidden={decorative || undefined}
        width={px}
        height={px}
        loading={size === 'lg' ? 'eager' : 'lazy'}
        decoding="async"
        data-person-photo=""
        data-shape={square ? 'square' : 'round'}
        className={cx('shrink-0 border-border-strong bg-surface-2 object-cover', shape, className)}
        style={box}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-person-monogram=""
      data-shape={square ? 'square' : 'round'}
      className={cx(
        'inline-grid shrink-0 place-items-center border-border-strong leading-none font-semibold tracking-normal text-fg-muted',
        square ? shape : 'rounded-xs border',
        text,
        className,
      )}
      style={box}
    >
      {monogram(name)}
    </span>
  );
}
