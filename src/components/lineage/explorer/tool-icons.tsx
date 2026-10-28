// The explorer canvas's own tool icons (milestone M06): drawn as the rest of the set
// (components/icons.tsx), but kept here, in the canvas's chunk, so that no other page's (and not
// the explorer's first) JavaScript carries them.

import { icon } from '@/components/icons';

/** Centre the view on the selected (or the active) person: a ring with four ticks. */
export const CenterIcon = icon(
  'Center',
  <>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
  </>,
  1.8,
);

/** The keyboard shortcuts: a keyboard. */
export const KeyboardIcon = icon(
  'Keyboard',
  <>
    <rect x="3" y="6.5" width="18" height="11" rx="1.5" />
    <path d="M7 10.5h.01M10.3 10.5h.01M13.7 10.5h.01M17 10.5h.01M8 14h8" />
  </>,
);
