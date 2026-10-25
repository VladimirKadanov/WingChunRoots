// Search keys (milestone M07, Done when 2): the Streamlined System, pinyin and Jyutping of the
// demo-cjk-name person, Traditional and Simplified folding, tone marks, and lossless NFC storage of
// Cyrillic and Chinese names. Only the fictional demo names of src/fixtures (D20).

import ToJyutping from 'to-jyutping';
import { describe, expect, it } from 'vitest';

import { generateFixtures } from '../../fixtures/generate';
import { checkNames } from '../services/profile';
import { hongKongSpellings, SURNAME_READINGS } from './aliases';
import { bgStreamlined } from './bg-streamlined';
import { foldLatin, type GeneratedKey, keysForName, type NameForKeys, queryForms, stripToneNumbers } from './keys';

const fixtures = generateFixtures();
function demoNames(slug: string): NameForKeys[] {
  const p = fixtures.persons.find((x) => x.slug === slug);
  if (!p) throw new Error(`no demo person ${slug}`);
  return fixtures.personNames.filter((n) => n.personId === p.id);
}
const keysOf = (names: readonly NameForKeys[]): GeneratedKey[] => names.flatMap((n) => keysForName(n));
const keyStrings = (keys: readonly GeneratedKey[], kind?: GeneratedKey['keyKind']) =>
  keys.filter((k) => kind === undefined || k.keyKind === kind).map((k) => k.key);

const name = (value: string, script: string, lang: string, romanization: string | null = null, kind = 'name'): NameForKeys => ({
  value,
  script,
  lang,
  kind,
  romanization,
});

describe('the Bulgarian Streamlined System', () => {
  it('"Тестов" gives testov', () => {
    expect(bgStreamlined('Тестов')).toBe('testov');
    expect(queryForms('Тестов').map((f) => f.text)).toContain('testov');
  });

  it('follows the official rules for щ, ъ, ю, я, ц and a word-final ия', () => {
    expect(bgStreamlined('Щерю Ъглов Юлия Цонева')).toBe('shteryu aglov yulia tsoneva');
    expect(bgStreamlined('Мария Янева')).toBe('maria yaneva');
  });

  it('keys a Bulgarian Cyrillic name by its Streamlined form', () => {
    const keys = keysForName(name('Десислава Примерова', 'Cyrl', 'bg-Cyrl'));
    expect(keys).toContainEqual({ key: 'desislava primerova', keyKind: 'latin', source: 'bg_streamlined' });
    expect(keys).toContainEqual({ key: 'десислава примерова', keyKind: 'cyrillic', source: 'name' });
  });
});

describe('Chinese names (demo-cjk-name)', () => {
  const names = demoNames('demo-cjk-name');
  const traditional = names.find((n) => n.script === 'Hant')!;
  const simplified = names.find((n) => n.script === 'Hans')!;

  it('has the Traditional and Simplified spellings in the demo data', () => {
    expect(traditional.value).toBe('蘇晴嵐');
    expect(simplified.value).toBe('苏晴岚');
  });

  it('generates pinyin and Jyutping keys from the characters', () => {
    const generated = keysForName(traditional);
    expect(generated).toContainEqual({ key: 'su qing lan', keyKind: 'pinyin', source: 'pinyin-pro' });
    expect(generated).toContainEqual({ key: 'suqinglan', keyKind: 'pinyin', source: 'pinyin-pro' });
    expect(generated).toContainEqual({ key: 'sou cing laam', keyKind: 'jyutping', source: 'to-jyutping' });
    expect(generated).toContainEqual({ key: 'soucinglaam', keyKind: 'jyutping', source: 'to-jyutping' });
  });

  it('gives the Traditional and the Simplified spelling the same key', () => {
    const t = keyStrings(keysForName(traditional), 'han');
    const s = keyStrings(keysForName(simplified), 'han');
    expect(t).toEqual(['苏晴岚']);
    expect(s).toEqual(t);
    expect(queryForms('蘇晴嵐')).toEqual(queryForms('苏晴岚'));
    expect(queryForms('蘇晴')).toEqual([{ text: '苏晴', han: true }]);
    // And every generated key of the two spellings is the same.
    expect(keyStrings(keysForName(traditional))).toEqual(keyStrings(keysForName(simplified)));
  });

  it('keys the stored Jyutping and pinyin without their tones', () => {
    const all = keysOf(names);
    expect(keyStrings(all, 'jyutping')).toContain('sou cing laam');
    expect(keyStrings(all, 'pinyin')).toContain('su qinglan');
  });

  it('keys a Jyutping name by its Hong Kong spelling too', () => {
    expect(keyStrings(keysForName(traditional), 'alias')).toContain('so ching lam');
    expect(hongKongSpellings('zoeng')).toEqual(['cheung', 'cheong']);
    expect(hongKongSpellings('gwok')).toEqual(['kwok']);
    expect(hongKongSpellings('xyz')).toEqual([]);
  });
});

describe('Chinese characters fold one at a time, whatever the phrase around them', () => {
  // A fictional name whose last two characters are an OpenCC phrase (乾坤 keeps 乾; 乾 alone is 干).
  const han = (value: string) => keyStrings(keysForName(name(value, 'Hant', 'zh-Hant')), 'han');

  it('gives a name and the start of it typed as a query the same characters', () => {
    const [key] = han('李乾坤');
    const prefix = queryForms('李乾')[0]!;
    const single = queryForms('乾')[0]!;
    expect(prefix.han && single.han).toBe(true);
    expect(key!.startsWith(prefix.text)).toBe(true);
    expect(key).toContain(single.text);
    // The fold is the same for the Simplified spelling.
    expect(han('李乾坤')).toEqual(keyStrings(keysForName(name('李干坤', 'Hans', 'zh-Hans')), 'han'));
  });
});

describe('surnames read their own way', () => {
  // Fictional names: a polyphonic surname and the given name 雲石 / 云石.
  const pairs = [
    ['單雲石', '单云石'],
    ['區雲石', '区云石'],
    ['繆雲石', '缪云石'],
    ['樂雲石', '乐云石'],
    ['車雲石', '车云石'],
    ['長孫雲石', '长孙云石'],
  ] as const;

  it('gives the Traditional spelling the surname pinyin of the Simplified one', () => {
    for (const [traditional, simplified] of pairs) {
      const t = keyStrings(keysForName(name(traditional, 'Hant', 'zh-Hant')), 'pinyin');
      const s = keyStrings(keysForName(name(simplified, 'Hans', 'zh-Hans')), 'pinyin');
      expect(t, traditional).toEqual(expect.arrayContaining(s));
    }
    expect(keyStrings(keysForName(name('區雲石', 'Hant', 'zh-Hant')), 'pinyin')).toContain('ou yun shi');
    expect(keyStrings(keysForName(name('單雲石', 'Hant', 'zh-Hant')), 'pinyin')).toContain('shan yun shi');
  });

  it('keys a Cantonese surname by its surname reading and its Hong Kong spelling', () => {
    const tsang = keysForName(name('曾雲石', 'Hant', 'zh-Hant'));
    expect(tsang).toContainEqual({ key: 'zang wan sek', keyKind: 'jyutping', source: 'alias:surname-reading' });
    expect(keyStrings(tsang, 'alias')).toContain('tsang wan sek');
    // The everyday reading stays a key too.
    expect(keyStrings(tsang, 'jyutping')).toContain('cang wan sek');
    expect(keyStrings(keysForName(name('區雲石', 'Hant', 'zh-Hant')), 'jyutping')).toContain('au wan sek');
    expect(keyStrings(keysForName(name('区云石', 'Hans', 'zh-Hans')), 'alias')).toContain('au wan sek');
    expect(keyStrings(keysForName(name('單雲石', 'Hant', 'zh-Hant')), 'alias')).toContain('sin wan sek');
    // A query for the Hong Kong surname or the toneless Jyutping meets a key.
    const keys = keyStrings(tsang);
    expect(keys.some((k) => k.startsWith(queryForms('Tsang')[0]!.text))).toBe(true);
    expect(keys.some((k) => k.startsWith(queryForms('zang1')[0]!.text))).toBe(true);
  });

  it('takes every surname reading from to-jyutping\'s own candidates', () => {
    for (const [surname, readings] of Object.entries(SURNAME_READINGS)) {
      const candidates = ToJyutping.getJyutpingCandidates(surname);
      expect(candidates, surname).toHaveLength(readings.length);
      readings.forEach((reading, i) => expect(candidates[i]![1], surname).toContain(reading));
    }
  });
});

describe('tone marks and tone numbers', () => {
  it('removes tone marks and diacritics', () => {
    expect(foldLatin('Sū Qínglán')).toBe('su qinglan');
    expect(foldLatin('Lǚ Ǹ')).toBe('lu n');
    expect(foldLatin('Ðorđe Łukasz Straße')).toBe('dorde lukasz strasse');
  });

  it('removes tone numbers from Jyutping and pinyin, in names and in queries', () => {
    expect(stripToneNumbers('sou1 cing4 laam4')).toBe('sou cing laam');
    expect(keyStrings(keysForName(name('su1 qing2 lan2', 'Latn', 'zh-Latn-pinyin', 'pinyin', 'romanization')), 'pinyin')).toContain('su qing lan');
    expect(queryForms('sou1 cing4').map((f) => f.text)).toEqual(['sou cing', 'soucing']);
  });

  it('a toneless query and the toned name meet in the same key', () => {
    const toned = keyStrings(keysForName(name('Sū Qínglán', 'Latn', 'zh-Latn-pinyin', 'pinyin', 'romanization')));
    expect(queryForms('su qinglan').some((f) => toned.includes(f.text))).toBe(true);
    expect(queryForms('suqinglan').some((f) => toned.includes(f.text))).toBe(true);
  });
});

describe('names are stored and read back without loss (NFC)', () => {
  it('keeps a Cyrillic and a Chinese name exactly, in NFC', () => {
    const cyrillic = 'Десислава Примерова';
    const chinese = '蘇晴嵐';
    // A decomposed й (и + combining breve) is stored composed, the letters unchanged.
    const decomposed = 'Йордан Тестов'.normalize('NFD');
    const [c, h, d] = checkNames([
      { kind: 'name', value: 'Desislava Primerova', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true },
      { kind: 'name', value: cyrillic, script: 'Cyrl', lang: 'bg-Cyrl', romanization: null, isPrimary: false },
      { kind: 'name', value: chinese, script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: false },
      { kind: 'name', value: decomposed, script: 'Cyrl', lang: 'bg-Cyrl', romanization: null, isPrimary: false },
    ]).slice(1);
    expect(c!.value).toBe(cyrillic);
    expect(h!.value).toBe(chinese);
    expect(d!.value).toBe('Йордан Тестов'.normalize('NFC'));
    expect(d!.value).not.toBe(decomposed);
    for (const n of [c!, h!, d!]) expect(n.value.normalize('NFC')).toBe(n.value);
  });

  it('refuses a profile without a Latin-script primary name, with a clear message', () => {
    expect(() =>
      checkNames([{ kind: 'name', value: '蘇晴嵐', script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: true }]),
    ).toThrow('Add your name in Latin letters and choose it as your display name.');
    expect(() =>
      checkNames([{ kind: 'name', value: 'Ivan Testov', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: false }]),
    ).toThrow('Add your name in Latin letters and choose it as your display name.');
  });
});

describe('queries', () => {
  it('has no form for an empty or punctuation-only query', () => {
    expect(queryForms('')).toEqual([]);
    expect(queryForms('  -- ')).toEqual([]);
  });

  it('reads a Cyrillic query as Cyrillic and in Latin letters', () => {
    expect(queryForms('Тестов')).toEqual([
      { text: 'тестов', han: false },
      { text: 'testov', han: false },
    ]);
  });

  it('keys any other script by its usual Latin transliteration', () => {
    expect(keyStrings(keysForName(name('Δοκιμή', 'Grek', 'el')))).toEqual(['dokimi']);
    // And a query in that script meets the key.
    expect(queryForms('Δοκιμή').map((f) => f.text)).toContain('dokimi');
  });
});
