import { describe, expect, it } from 'vitest';

import {
  canBePrimary,
  keysOfSlots,
  LATIN_WRITING,
  MISSING_PRIMARY,
  nameField,
  primaryRefusal,
  PROFILE_MAX_NAMES,
  type ProfileFormValues,
  sameNames,
  shownFormValues,
  shownSlots,
  SPARE_ROWS,
  spareRowCount,
} from './profile-form';
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

describe('shownFormValues (what the fields hold when the editor hydrates)', () => {
  /** The fields as the server draws the editor: the saved rows, then spare rows, then the rest. */
  const drawn = (rows: { value: string; writing?: string; kind?: string; spare?: boolean }[], fields: Record<string, string> = {}) => {
    const form = new FormData();
    rows.forEach((row, i) => {
      if (row.spare) form.set(`names.${i}.spare`, '1');
      form.set(nameField(i, 'value'), row.value);
      form.set(nameField(i, 'writing'), row.writing ?? LATIN_WRITING);
      form.set(nameField(i, 'kind'), row.kind ?? 'name');
    });
    for (const [name, value] of Object.entries({ primary: '0', bio: '', bioLang: 'en', countryCode: '', placeId: '', trainingStartYear: '', ...fields })) {
      form.set(name, value);
    }
    return form;
  };
  const saved = [
    { value: 'Demo Lantern Example', writing: LATIN_WRITING },
    { value: '測試燈', writing: HANT },
  ];

  it('gives back the values the page was drawn with when nothing was changed (spare rows left empty are dropped)', () => {
    const shown = shownFormValues(drawn([...saved, { value: '', spare: true }, { value: '', spare: true }]));
    expect(shown).toEqual({
      names: [
        { value: 'Demo Lantern Example', writing: LATIN_WRITING, kind: 'name' },
        { value: '測試燈', writing: HANT, kind: 'name' },
      ],
      primary: 0,
      bio: '',
      bioLang: 'en',
      countryCode: '',
      placeId: '',
      trainingStartYear: '',
      showPublicly: false,
    });
  });

  it('takes over a display name typed over, a name typed in a spare row, and the other fields', () => {
    const shown = shownFormValues(
      drawn([{ ...saved[0]!, value: 'Demo Inkwell Example' }, saved[1]!, { value: '', spare: true }, { value: 'Тест Облак', writing: 'Cyrl|bg-Cyrl|', spare: true }], {
        trainingStartYear: '2009',
        bio: 'Demo biography.',
        showPublicly: 'on',
      }),
    );
    expect(shown.names).toEqual([
      { value: 'Demo Inkwell Example', writing: LATIN_WRITING, kind: 'name' },
      { value: '測試燈', writing: HANT, kind: 'name' },
      { value: 'Тест Облак', writing: 'Cyrl|bg-Cyrl|', kind: 'name' },
    ]);
    expect(shown.primary).toBe(0);
    expect(shown).toMatchObject({ trainingStartYear: '2009', bio: 'Demo biography.', showPublicly: true });
  });

  it('keeps an emptied saved row, and follows the ticked display name to its row', () => {
    const shown = shownFormValues(drawn([saved[0]!, { value: '', writing: HANT }, { value: '', spare: true }, { value: 'Demo Second Name', spare: true }], { primary: '3' }));
    expect(shown.names.map((n) => n.value)).toEqual(['Demo Lantern Example', '', 'Demo Second Name']);
    expect(shown.primary).toBe(2);
  });

  it('drops a ticked display name that can no longer be one, and has none when no radio is ticked', () => {
    expect(shownFormValues(drawn([{ ...saved[0]!, kind: 'alias' }, saved[1]!])).primary).toBe(-1);
    expect(shownFormValues(drawn([{ ...saved[0]!, writing: HANT }, saved[1]!])).primary).toBe(-1);
    const none = drawn(saved);
    none.delete('primary');
    expect(shownFormValues(none).primary).toBe(-1);
  });
});

describe('shownSlots and keysOfSlots (each row keeps the node of the fields it was typed in)', () => {
  const drawn = (rows: { value: string; spare?: boolean }[]) => {
    const form = new FormData();
    rows.forEach((row, i) => {
      if (row.spare) form.set(`names.${i}.spare`, '1');
      form.set(nameField(i, 'value'), row.value);
      form.set(nameField(i, 'writing'), LATIN_WRITING);
      form.set(nameField(i, 'kind'), 'name');
    });
    form.set('primary', '0');
    return form;
  };
  const keys = ['row-0', 'row-1', 'row-2', 'row-3'];

  it('gives the index of the fields of every kept row, an emptied saved row included', () => {
    expect(shownSlots(drawn([{ value: 'Demo Lantern Example' }, { value: '' }, { value: '', spare: true }, { value: '', spare: true }]))).toEqual([0, 1]);
    expect(shownSlots(drawn([{ value: 'Demo Lantern Example' }, { value: '', spare: true }, { value: 'Demo Second Name', spare: true }]))).toEqual([0, 2]);
  });

  it('keeps the keys when no row moved (spare rows left empty at the end are only dropped)', () => {
    expect(keysOfSlots(keys, [0, 1])).toBeNull();
    expect(keysOfSlots(keys, [])).toBeNull();
  });

  it('gives a row typed into the second spare row the key of that row when the first was left empty', () => {
    expect(keysOfSlots(keys, [0, 2])).toEqual(['row-0', 'row-2']);
    expect(keysOfSlots(keys, [0, 1, 3])).toEqual(['row-0', 'row-1', 'row-3']);
  });
});

describe('spareRowCount', () => {
  it('offers the spare rows below the saved names, never more than the names allowed', () => {
    expect(spareRowCount(1)).toBe(SPARE_ROWS);
    expect(spareRowCount(PROFILE_MAX_NAMES - 1)).toBe(1);
    expect(spareRowCount(PROFILE_MAX_NAMES)).toBe(0);
  });
});

describe('sameNames', () => {
  it('compares the value, the writing and the kind of each row, in order', () => {
    const rows = values().names;
    expect(sameNames(rows, rows.map((row) => ({ ...row, spare: true })))).toBe(true);
    expect(sameNames(rows, [...rows].reverse())).toBe(false);
    expect(sameNames(rows, rows.slice(1))).toBe(false);
    expect(sameNames(rows, rows.map((row, i) => (i === 0 ? { ...row, kind: 'alias' as const } : row)))).toBe(false);
  });
});
