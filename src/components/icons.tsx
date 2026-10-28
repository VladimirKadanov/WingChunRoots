// Line icons of the "Ink Register" direction (from the Ink Lineage prototype): 24 px grid,
// 1.6 px round strokes in the current colour. Decorative: every icon sits next to a text
// label or inside a control with an accessible name. No icon library is added (ADR 0006).

import type { ReactNode, SVGProps } from 'react';
import { cx } from '@/lib/cx';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

/** An icon of this set (also for a few icons kept in the chunk of the one island that draws them). */
export function icon(name: string, body: ReactNode, strokeWidth = 1.6) {
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
/** A circle with an exclamation mark: next to an error message (the words say what is wrong). */
export const AlertIcon = icon(
  'Alert',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.4v.1" strokeWidth={2.4} />
  </>,
);
export const CopyIcon = icon(
  'Copy',
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
    <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>,
);
export const DownloadIcon = icon(
  'Download',
  <>
    <path d="M12 4.5v10.5M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </>,
);
export const ExternalAppIcon = icon(
  'ExternalApp',
  <>
    <path d="M13.5 4.5h6v6M19.5 4.5l-8 8" />
    <path d="M17.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5" />
  </>,
);
// M08: notifications, planned features and "not included" in the plan tables.
export const BellIcon = icon(
  'Bell',
  <>
    <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </>,
);
/** An open circle with a clock hand: a feature that is planned, not available yet (with its text). */
export const PlannedIcon = icon(
  'Planned',
  <>
    <circle cx="12" cy="12" r="8.5" strokeDasharray="2.6 2.4" />
    <path d="M12 7.5V12l3 2" />
  </>,
);
/** A short dash: not included (always beside the words "Not included"). */
export const DashIcon = icon('Dash', <path d="M7 12h10" />, 1.9);
// M05: the explorer's zoom controls.
export const PlusIcon = icon('Plus', <path d="M12 6v12M6 12h12" />, 1.8);
export const MinusIcon = icon('Minus', <path d="M6 12h12" />, 1.8);
/** Fit the whole drawing in view: four corners. */
export const FitIcon = icon('Fit', <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />, 1.8);
