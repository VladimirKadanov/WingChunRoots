// The country list of onboarding (milestone M02, In scope 5): ISO 3166-1 alpha-2 codes only, one
// entry per country, so no second "United Kingdom" (UK) or a former country (SU, DD, YU) is offered.

import { describe, expect, it } from 'vitest';

import { COUNTRIES, isCountryCode } from './account';

describe('COUNTRIES', () => {
  it('has one entry per name and only current codes', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const code of ['UK', 'SU', 'DD', 'YU', 'CS', 'ZR', 'FX', 'EU', 'UN', 'IC', 'EA', 'AC', 'TA', 'CP', 'DG', 'CQ']) {
      expect(isCountryCode(code), code).toBe(false);
    }
    for (const code of ['GB', 'DE', 'RU', 'RS', 'BG', 'CN', 'HK', 'TW', 'MO', 'US']) {
      expect(isCountryCode(code), code).toBe(true);
    }
  });

  it('is sorted by English name', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names);
  });
});
