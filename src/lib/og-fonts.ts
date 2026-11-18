// The fonts of the generated Open Graph and share images (M11, ADR 0045): the app's own Noto Serif
// Display (Latin, Latin Extended, Greek and Cyrillic subsets, from @fontsource), read from disk, so
// next/og makes no font request. Text in another script is left out with drawable() (og-text.ts).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FONT_DIR = join(process.cwd(), 'node_modules', '@fontsource', 'noto-serif-display', 'files');
const SUBSETS = ['latin', 'latin-ext', 'greek', 'cyrillic'];

export const OG_FONT = 'Noto Serif Display';

export const OG_COLOURS = { ink: '#121214', paper: '#EDEBE5', muted: '#A8A49A', seal: '#D32F2F' } as const;

export async function ogFonts() {
  return Promise.all(
    SUBSETS.map(async (subset) => ({
      name: OG_FONT,
      data: await readFile(join(FONT_DIR, `noto-serif-display-${subset}-400-normal.woff`)),
      weight: 400 as const,
      style: 'normal' as const,
    })),
  );
}
