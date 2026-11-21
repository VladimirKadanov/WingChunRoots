import { describe, expect, it } from 'vitest';

import { ART_MOTIFS, drawArt, eventMotif, monogram, organizationMotif, schoolMotif, seedOf } from './ink-art';

describe('drawArt', () => {
  it('draws the same picture for the same slug and motif', () => {
    for (const motif of ART_MOTIFS) expect(drawArt('demo-school-sofia', motif)).toEqual(drawArt('demo-school-sofia', motif));
  });

  it('draws different pictures for different slugs', () => {
    expect(drawArt('demo-school-sofia', 'hills')).not.toEqual(drawArt('demo-school-athens', 'hills'));
  });

  it('gives every motif something to draw, inside numbers only', () => {
    for (const motif of ART_MOTIFS) {
      const art = drawArt('demo-x', motif);
      expect(art.shapes.length + (art.tile ? 1 : 0)).toBeGreaterThan(0);
      expect(JSON.stringify(art)).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it('draws the lattice as a tile', () => {
    const art = drawArt('demo-federation-north', 'lattice');
    expect(art.tile?.size).toBe(56);
    expect(art.shapes).toEqual([]);
  });
});

describe('motifs', () => {
  it('picks a motif per event kind, rings for online', () => {
    expect(eventMotif('seminar', false)).toBe('hills');
    expect(eventMotif('camp', false)).toBe('peaks');
    expect(eventMotif('exam_session', false)).toBe('dummy');
    expect(eventMotif('other', false)).toBe('enso');
    expect(eventMotif('camp', true)).toBe('rings');
  });

  it('grows roots for a group of schools and a lattice for the others', () => {
    expect(organizationMotif('school_group')).toBe('roots');
    expect(organizationMotif('federation')).toBe('lattice');
    expect(organizationMotif('association')).toBe('lattice');
  });
});

describe('seedOf and monogram', () => {
  it('is stable', () => {
    expect(seedOf('abc')).toBe(seedOf('abc'));
    expect(seedOf('abc')).not.toBe(seedOf('abd'));
  });

  it('takes the first and last initial, without filler words', () => {
    expect(monogram('Demo Wing Chun Hall Sofia')).toBe('WS');
    expect(monogram('Demo Federation North')).toBe('FN');
    expect(monogram('Kwoon')).toBe('K');
    expect(monogram('Demo Hall Hamburg (draft)')).toBe('HH');
    expect(monogram('---')).toBe('?');
  });
});

describe('schoolMotif', () => {
  it('is hills or peaks, the same for the same slug', () => {
    expect(['hills', 'peaks']).toContain(schoolMotif('demo-school-sofia'));
    expect(schoolMotif('demo-school-sofia')).toBe(schoolMotif('demo-school-sofia'));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => schoolMotif(`demo-school-${i}`)));
    expect(seen.size).toBeGreaterThan(1);
  });
});
