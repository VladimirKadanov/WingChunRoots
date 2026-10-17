// Line icons of the "Ink Register" direction (from the Ink Lineage prototype): 24 px grid,
// 1.6 px round strokes in the current colour. Decorative: every icon sits next to a text
// label or inside a control with an accessible name. No icon library is added (ADR 0006).

import type { ReactNode, SVGProps } from 'react';
import { cx } from '@/lib/cx';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function icon(name: string, body: ReactNode, strokeWidth = 1.6) {
  function Icon({ size = 22, className, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={cx('block shrink-0', className)}
        {...props}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = `${name}Icon`;
  return Icon;
}

export const SearchIcon = icon(
  'Search',
  <>
    <circle cx="10.5" cy="10.5" r="6.3" />
    <path d="M15.2 15.2l5.3 5.3" />
  </>,
  1.7,
);
export const LineageIcon = icon(
  'Lineage',
  <>
    <circle cx="12" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="19" r="2" />
    <path d="M12 7v3M12 10c-6 0-6 4-6 7M12 10c6 0 6 4 6 7" />
  </>,
);
export const SchoolsIcon = icon(
  'Schools',
  <>
    <path d="M4 10.5L12 4l8 6.5" />
    <path d="M6 9v10.5h12V9" />
    <path d="M10 19.5v-5h4v5" />
  </>,
);
export const MeIcon = icon(
  'Me',
  <>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M4.8 20c.8-3.9 3.6-6 7.2-6s6.4 2.1 7.2 6" />
  </>,
);
export const SunIcon = icon(
  'Sun',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
  </>,
);
export const MoonIcon = icon('Moon', <path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z" />);
export const SystemThemeIcon = icon(
  'SystemTheme',
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
  </>,
);
export const ArrowRightIcon = icon('ArrowRight', <path d="M5 12h14M13 6l6 6-6 6" />, 1.8);
export const ArrowLeftIcon = icon('ArrowLeft', <path d="M19 12H5M11 6l-6 6 6 6" />, 1.8);
export const CloseIcon = icon('Close', <path d="M6 6l12 12M18 6L6 18" />, 1.8);
export const CheckIcon = icon('Check', <path d="M5 12.5l4.5 4.5L19 7.5" />, 1.9);
export const ChevronDownIcon = icon('ChevronDown', <path d="M6 9.5l6 6 6-6" />, 1.8);
export const LockIcon = icon(
  'Lock',
  <>
    <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </>,
);
export const PinIcon = icon(
  'Pin',
  <>
    <path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </>,
);
