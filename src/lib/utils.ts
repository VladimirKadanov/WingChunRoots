// Class name helper of the shadcn/ui convention (components.json "utils"): clsx for
// conditions, tailwind-merge for conflicts. tailwind-merge learns the design tokens, so
// `text-caption` (a size) and `text-fg` (a colour) never cancel each other out.

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { COLOR_ROLES, radius, typeScale } from '@/design/tokens';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [...COLOR_ROLES, 'scrim'],
      text: Object.keys(typeScale),
      font: ['display', 'sans', 'mono'],
      radius: Object.keys(radius),
      shadow: ['pop', 'sheet', 'raise'],
      ease: ['out', 'in-out', 'stamp'],
      spacing: ['touch', 'tab', 'top', 'rail', 'sheet', 'section', 'section-desktop'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
