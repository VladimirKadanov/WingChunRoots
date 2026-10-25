import { describe, expect, it } from 'vitest';

import { canBePrimary, LATIN_WRITING, MISSING_PRIMARY, nameField, primaryRefusal, type ProfileFormValues } from './profile-form';
import { profileFormErrors } from './profile-form-rules';

const YEAR = 2026;
const JYUTPING = 'Latn|yue-Latn|jyutping';
const PINYIN = 'Latn|zh-Latn-pinyin|pinyin';
const HK = 'Latn|yue-Latn|hk_gov';
const HANT = 'Hant|zh-Hant|';

const values = (patch: Partial<ProfileFormValues> = {}): ProfileFormValues => ({
  names: [
    { value: 'Demo Lantern Example', writing: LATIN_WRITING, kind: 'name' },
    { value: '測試燈', writing: HANT, kind: 'name' },
    { value: 'dang1 lung4', writing: JYUTPING, kind: 'name' },
  ],
  primary: 0,
  bio: '',
  bioLang: 'en',
  countryCode: '',
  placeId: '',
  trainingStartYear: '',
  showPublicly: false,
  ...patch,
});

describe('profileFormErrors (the Zod rules the editor checks before sending)', () => {
  it('passes a profile with a Latin display name and names in other scripts', () => {
    expect(profileFormErrors(values(), YEAR)).toEqual({});
  });

  it('asks for a display name when none is chosen', () => {
    expect(profileFormErrors(values({ primary: -1 }), YEAR)).toEqual({ names: MISSING_PRIMARY });
  });

  it('says why each refused display name cannot be one, and what to change', () => {
    const jyutping = profileFormErrors(values({ primary: 2 }), YEAR);
    expect(jyutping.names).toBe(MISSING_PRIMARY);
    expect(jyutping[nameField(2, 'isPrimary')]).toBe('Jyutping and pinyin help people find you; your display name is your everyday spelling.');
    const han = profileFormErrors(values({ primary: 1 }), YEAR);
    expect(han[nameField(1, 'isPrimary')]).toBe('Choose “Latin letters” or “Cantonese, Hong Kong spelling” under “Written in” to use this name.');
    const alias = profileFormErrors(values({ names: [{ value: 'Demo Lantern', writing: LATIN_WRITING, kind: 'alias' }], primary: 0 }), YEAR);
    expect(alias[nameField(0, 'isPrimary')]).toBe('A name marked “Also known as” cannot be your display name.');
  });

  it('checks each name against how it says it is written, and refuses a name twice', () => {
    const wrong = profileFormErrors(values({ names: [{ value: 'Demo Lantern', writing: LATIN_WRITING, kind: 'name' }, { value: 'Demo', writing: HANT, kind: 'name' }] }), YEAR);
    expect(wrong[nameField(1, 'value')]).toMatch(/not written in Chinese, Traditional characters/);
    const twice = profileFormErrors(
      values({ names: [{ value: 'Demo Lantern', writing: LATIN_WRITING, kind: 'name' }, { value: 'demo  lantern', writing: LATIN_WRITING, kind: 'name' }] }),
      YEAR,
    );
    expect(twice[nameField(1, 'value')]).toBe('This name is already in the list.');
    expect(profileFormErrors(values({ names: [{ value: ' ', writing: LATIN_WRITING, kind: 'name' }] }), YEAR)[nameField(0, 'value')]).toBe(
      'Enter the name, or remove this row.',
    );
  });

  it('bounds the biography and the year training started', () => {
    expect(profileFormErrors(values({ bio: 'x'.repeat(1001) }), YEAR).bio).toBe('Use at most 1000 characters.');
    expect(profileFormErrors(values({ trainingStartYear: '09' }), YEAR).trainingStartYear).toBe('Enter the year as four digits, for example 2009.');
    expect(profileFormErrors(values({ trainingStartYear: '1899' }), YEAR).trainingStartYear).toMatch(/before 1900/);
    expect(profileFormErrors(values({ trainingStartYear: '2027' }), YEAR).trainingStartYear).toMatch(/after this year/);
    expect(profileFormErrors(values({ trainingStartYear: '2009' }), YEAR)).toEqual({});
  });
});

describe('primaryRefusal and canBePrimary', () => {
  it('allow Latin letters and the Hong Kong spelling, of kind name', () => {
    expect(canBePrimary(LATIN_WRITING, 'name')).toBe(true);
    expect(canBePrimary(HK, 'name')).toBe(true);
    expect(primaryRefusal(HK, 'name')).toBeNull();
  });

  it('refuse Jyutping, pinyin, an alias and other scripts, each with its reason', () => {
    expect(primaryRefusal(JYUTPING, 'name')).toMatch(/^Jyutping and pinyin/);
    expect(primaryRefusal(PINYIN, 'name')).toMatch(/^Jyutping and pinyin/);
    expect(primaryRefusal(LATIN_WRITING, 'alias')).toMatch(/Also known as/);
    expect(primaryRefusal(HANT, 'name')).toMatch(/under “Written in”/);
    expect(primaryRefusal('Cyrl|bg-Cyrl|', 'name')).toMatch(/under “Written in”/);
  });
});
