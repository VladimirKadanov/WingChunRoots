// The brand mark: a red seal stamped with 根 ("root"). The glyph is an outline traced from
// Noto Serif TC Bold (SIL OFL 1.1; licenses/addenda/noto-serif-tc.md), so the mark looks the
// same on every device without a CJK web font. Red is reserved for this mark and for the
// primary action (ADR 0006).

import { cn } from '@/lib/utils';

const GLYPH =
  'M14.45 8.03L14.88 8.29L14.88 19.99L13.28 20.52L13.99 19.96Q14.12 20.75 13.84 21.19Q13.56 21.62 13.27 21.75L12.44 19.94Q12.9 19.71 13.02 19.54Q13.13 19.36 13.13 19.05L13.13 8.03ZM13.13 6.71L15.1 7.52L14.88 7.52L14.88 8.51Q14.88 8.51 14.47 8.51Q14.06 8.51 13.13 8.51L13.13 7.52ZM19.44 7.52L19.44 7.99L14.26 7.99L14.26 7.52ZM12.9 19.82Q13.28 19.74 13.94 19.59Q14.6 19.45 15.43 19.24Q16.25 19.03 17.11 18.82L17.18 19Q16.83 19.26 16.27 19.67Q15.71 20.07 14.99 20.55Q14.27 21.03 13.5 21.51ZM21.7 15.62Q21.55 15.83 21.1 15.73Q20.77 15.98 20.19 16.35Q19.6 16.72 18.91 17.09Q18.22 17.46 17.54 17.73L17.42 17.61Q17.85 17.17 18.32 16.54Q18.79 15.91 19.2 15.31Q19.6 14.71 19.82 14.33ZM16.17 13.42Q16.62 14.99 17.45 16.28Q18.28 17.56 19.42 18.47Q20.56 19.38 21.93 19.86L21.9 20.02Q21.4 20.15 21.01 20.58Q20.62 21.01 20.46 21.69Q19.17 20.91 18.28 19.78Q17.39 18.65 16.83 17.09Q16.27 15.52 15.94 13.5ZM18.48 7.52L19.32 6.61L21.07 7.94Q20.99 8.04 20.82 8.13Q20.66 8.22 20.41 8.27L20.41 13.92Q20.41 13.98 20.16 14.12Q19.92 14.25 19.59 14.35Q19.26 14.46 18.94 14.46L18.64 14.46L18.64 7.52ZM19.34 10.34L19.34 10.82L14.16 10.82L14.16 10.34ZM19.34 13.32L19.34 13.8L14.16 13.8L14.16 13.32ZM10.36 12.07Q11.32 12.38 11.87 12.79Q12.42 13.19 12.63 13.62Q12.84 14.05 12.8 14.41Q12.75 14.78 12.53 14.99Q12.31 15.2 11.98 15.2Q11.65 15.2 11.3 14.91Q11.27 14.45 11.1 13.95Q10.92 13.46 10.68 12.99Q10.44 12.51 10.18 12.17ZM10.99 6.46Q10.97 6.64 10.85 6.76Q10.72 6.87 10.38 6.92L10.38 21.18Q10.38 21.26 10.16 21.4Q9.93 21.54 9.61 21.65Q9.29 21.75 8.94 21.75L8.58 21.75L8.58 6.23ZM10.26 10.53Q9.83 12.75 8.84 14.6Q7.85 16.46 6.27 17.91L6.07 17.71Q6.7 16.72 7.15 15.48Q7.61 14.25 7.92 12.92Q8.23 11.59 8.41 10.27L10.26 10.27ZM11.45 9.02Q11.45 9.02 11.72 9.26Q12 9.5 12.36 9.83Q12.72 10.17 13 10.49Q12.94 10.75 12.56 10.75L6.35 10.75L6.22 10.27L10.58 10.27Z';

/** Decorative unless it has a `label` (then an image with that name, as at the end of the home page's headline). */
export function BrandSeal({ size = 26, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
      className={cn('block shrink-0', className)}
    >
      <path d="M2.4 2.1L25.7 2.7 25.3 25.8 2.1 25.4Z" fill="var(--brand)" />
      <path d={GLYPH} fill="var(--on-brand)" />
    </svg>
  );
}

/** Seal and wordmark. The wordmark is real text in the display face, so it stays accessible. */
export function BrandMark({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-fg', className)}>
      <BrandSeal size={size === 'lg' ? 30 : 26} />
      <span
        // truncate clips to the line box: leading-tight keeps the descender of the g inside it.
        className={cn('min-w-0 truncate font-display tracking-[-0.01em]', size === 'lg' ? 'text-xl' : 'text-lg', 'py-0.5 leading-tight')}
      >
        WingChunRoots
      </span>
    </span>
  );
}
