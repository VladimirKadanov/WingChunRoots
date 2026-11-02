// A person's picture on a card (milestone M14; docs/adr/0016-profile-photos.md): the profile
// photo as a small round thumbnail, or, without one, the monogram seal the cards had before (the
// first letters of the Latin name in a small square). Plain markup with no client code, so it is
// server-rendered in the lists and costs the explorer nothing but an <img>.
//
// The image: the 96 px rendition for every card (sharp on a 2x screen at 48 px), the 512 px one on
// the profile; `width` and `height` always set, so nothing moves when it arrives (CLS);
// `loading="lazy"` on cards (the explorer draws only the nodes on screen, so only those load) and
// eager on the profile, where it is part of the first screen. `alt` is the person's Latin display
// name (empty where the surrounding element is already named by it). The monogram is decorative
// (aria-hidden): the name is next to it.

import { cx } from '@/lib/cx';
import type { PhotoDto } from '@/server/dto/public';
import { monogram } from './monogram';

const SIZES = {
  /** The explorer's full card (the monogram's old 24 px slot). */
  xs: { px: 24, text: 'text-caption' },
  /** Lists, search results and school pages. */
  sm: { px: 32, text: 'text-xs' },
  /** The explorer's selection panel. */
  md: { px: 40, text: 'text-sm' },
  /** The profile's header, beside the name. */
  lg: { px: 96, text: 'text-3xl' },
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
   * Inside an element whose accessible name is already the person's name (the phone sheet's title),
   * the image is hidden from assistive technology so the name is not read twice.
   */
  decorative?: boolean;
  className?: string;
}) {
  const { px, text } = SIZES[size];
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
        className={cx('shrink-0 rounded-full border border-border-strong bg-surface-2 object-cover', className)}
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-person-monogram=""
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-xs border border-border-strong leading-none font-semibold tracking-normal text-fg-muted',
        text,
        className,
      )}
      style={{ width: px, height: px }}
    >
      {monogram(name)}
    </span>
  );
}
