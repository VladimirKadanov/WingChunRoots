import { describe, expect, it } from 'vitest';

import { mapsDirectionsHref, mapsSearchHref } from './directions';

describe('directions', () => {
  it('searches for the public place line, encoded', () => {
    expect(mapsSearchHref('Demo hall, Sofia, Bulgaria')).toBe('https://www.google.com/maps/search/?api=1&query=Demo%20hall%2C%20Sofia%2C%20Bulgaria');
  });
  it('leads to a public point', () => {
    expect(mapsDirectionsHref({ lat: 42.69751, lng: 23.32415 })).toBe('https://www.google.com/maps/dir/?api=1&destination=42.69751,23.32415');
  });
});
