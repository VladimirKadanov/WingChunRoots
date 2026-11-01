// The Open Graph image of a school's page (milestone M11, In scope 8): the school's name, its city
// and how its location is shown, its instructors' Latin-script names, drawn from the public DTO
// only (schools.get). No coordinates, no map: a city-only school's image is the same whatever its
// private address.
//
// No external request: the fonts are the app's own (Noto Serif Display's Latin, Latin Extended,
// Greek and Cyrillic subsets, from @fontsource), and text in another script is left out
// (src/lib/og-text.ts: next/og would fetch a font for it from Google Fonts). A school that is not public gets a plain image
// with status 404.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { drawable } from '@/lib/og-text';

import { loadSchool, locationLine } from './data';

export const alt = 'A Wing Chun school on WingChunRoots';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#121214';
const PAPER = '#EDEBE5';
const MUTED = '#A8A49A';
const SEAL = '#D32F2F';

const FONT_DIR = join(process.cwd(), 'node_modules', '@fontsource', 'noto-serif-display', 'files');
const SUBSETS = ['latin', 'latin-ext', 'greek', 'cyrillic'];

async function fonts() {
  return Promise.all(
    SUBSETS.map(async (subset) => ({
      name: 'Noto Serif Display',
      data: await readFile(join(FONT_DIR, `noto-serif-display-${subset}-400-normal.woff`)),
      weight: 400 as const,
      style: 'normal' as const,
    })),
  );
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const read = await loadSchool((await params).slug);
  const options = { ...size, fonts: await fonts() };
  if (read.state !== 'found') {
    return new ImageResponse(
      (
        <div style={{ display: 'flex', width: '100%', height: '100%', background: INK, color: PAPER, alignItems: 'center', justifyContent: 'center', fontSize: 64, fontFamily: 'Noto Serif Display' }}>
          WingChunRoots
        </div>
      ),
      { ...options, status: read.state === 'none' ? 404 : 503 },
    );
  }
  const { school } = read;
  const name = drawable(school.name) || 'A Wing Chun school';
  const instructors = school.instructors
    .map((i) => drawable(i.displayName.value))
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  const exact = school.precision === 'exact';
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: INK, color: PAPER, padding: '64px 72px', fontFamily: 'Noto Serif Display' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 28, color: MUTED }}>
          <div style={{ display: 'flex', width: 28, height: 28, background: SEAL, borderRadius: 4 }} />
          WingChunRoots · Schools
        </div>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
          <div style={{ display: 'flex', fontSize: name.length > 40 ? 64 : 84, lineHeight: 1.1 }}>{name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 34, color: PAPER }}>
            {exact ? (
              <svg width="40" height="40" viewBox="0 0 24 24">
                <path d="M12 22s7-6.6 7-12.2A7 7 0 0 0 5 9.8C5 15.4 12 22 12 22z" fill={PAPER} />
                <circle cx="12" cy="9.6" r="2.4" fill={INK} />
              </svg>
            ) : (
              <svg width="40" height="40" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8.2" fill="none" stroke={PAPER} strokeWidth="2.6" strokeDasharray="4.2 2.6" />
                <circle cx="12" cy="12" r="2" fill={PAPER} />
              </svg>
            )}
            {drawable(locationLine(school))}
          </div>
          {instructors ? <div style={{ display: 'flex', fontSize: 30, color: MUTED }}>{`Instructors: ${instructors}`}</div> : null}
        </div>
      </div>
    ),
    options,
  );
}
