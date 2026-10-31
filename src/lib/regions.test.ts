import { describe, expect, it } from 'vitest';

import { countryName, placeLine } from './regions';

describe('countryName', () => {
  it('names a region code in English', () => {
    expect(countryName('GB')).toBe('United Kingdom');
    expect(countryName('BG')).toBe('Bulgaria');
  });

  it('is null without a code and keeps what is not a region code', () => {
    expect(countryName(null)).toBeNull();
    expect(countryName('')).toBeNull();
    expect(countryName('1')).toBe('1');
  });
});

describe('placeLine', () => {
  it('joins the parts that are known, with the full country name', () => {
    expect(placeLine({ city: 'Demo City', countryCode: 'GB', lineage: 'Demo Lineage A' })).toBe('Demo City · United Kingdom · Demo Lineage A');
    expect(placeLine({ city: null, countryCode: 'BG', lineage: null })).toBe('Bulgaria');
    expect(placeLine({})).toBe('');
  });
});
