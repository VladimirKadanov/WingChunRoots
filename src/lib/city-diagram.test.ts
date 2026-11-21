import { describe, expect, it } from 'vitest';

import { cityDiagramPositions } from './city-diagram';

describe('cityDiagramPositions (ADR 0052)', () => {
  it('places nothing for no cities, and one city in the middle', () => {
    expect(cityDiagramPositions([])).toEqual([]);
    expect(cityDiagramPositions([{ lat: 42.7, lng: 23.3 }])).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('keeps north up and west left, with the longer side filling the square', () => {
    // Three fictional points: north-west, south-east and a third east of the first.
    const [nw, se, ne] = cityDiagramPositions([
      { lat: 44, lng: 20 },
      { lat: 40, lng: 24 },
      { lat: 44, lng: 24 },
    ]);
    expect(nw!.x).toBeLessThan(se!.x);
    expect(nw!.y).toBeLessThan(se!.y);
    expect(ne!.y).toBe(nw!.y);
    // Latitude spans 4°, longitude 4° × cos(42°) ≈ 3°: the north–south side fills the square.
    expect(nw!.y).toBe(0);
    expect(se!.y).toBe(1);
    expect(nw!.x).toBeGreaterThan(0);
    expect(se!.x).toBeLessThan(1);
  });

  it('does not stretch cities a few kilometres apart', () => {
    const [a, b] = cityDiagramPositions([
      { lat: 42.7, lng: 23.3 },
      { lat: 42.71, lng: 23.31 },
    ]);
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(0.05);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(0.05);
  });

  it('answers positions in the unit square only, never a coordinate', () => {
    for (const p of cityDiagramPositions([
      { lat: 51.5, lng: -0.12 },
      { lat: 37.98, lng: 23.73 },
      { lat: 42.7, lng: 23.32 },
    ])) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});
