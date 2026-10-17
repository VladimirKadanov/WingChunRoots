import { describe, expect, it } from 'vitest';

import { cleanName, isJyutping, isLatinName, isPinyin, matchesScript, originalScript, slugFromName } from './names';

describe('names (plan §5.3)', () => {
  it('cleans spaces and normalises to NFC', () => {
    expect(cleanName('  So \t Chuk-ching ')).toBe('So Chuk-ching');
    expect(cleanName('Zhú')).toBe('Zhú');
  });

  it.each([
    ['So Chuk-ching', true],
    ['Mira Probnova', true],
    ['Sū Zhúqíng', true],
    ["D'Arcy O’Neil", true],
    ['蘇竹晴', false],
    ['Мира Пробнова', false],
    ['Mira 蘇', false],
    ['Anna\u093C', false], // a Devanagari nukta: a combining mark, but not of the Latin script
    ['Z\u0332oe', true], // a combining low line (Script=Inherited) stays allowed
    ['---', false],
    ['', false],
  ])('isLatinName(%j) is %s', (value, expected) => {
    expect(isLatinName(value)).toBe(expected);
  });

  it('checks that an original name is in the script of its language', () => {
    expect(matchesScript('蘇竹晴', 'zh-Hant')).toBe(true);
    expect(matchesScript('Мира Пробнова', 'bg-Cyrl')).toBe(true);
    expect(matchesScript('Mira', 'zh-Hant')).toBe(false);
    expect(matchesScript('蘇竹晴 Mira', 'zh-Hant')).toBe(false);
    expect(matchesScript('蘇竹晴', 'xx')).toBe(false);
    expect(originalScript('zh-Hant')).toMatchObject({ script: 'Hant' });
  });

  it('accepts Jyutping with tone numbers and pinyin with tone marks', () => {
    expect(isJyutping('sou1 zuk1 cing4')).toBe(true);
    expect(isJyutping('sou zuk cing')).toBe(true);
    expect(isJyutping('sou9')).toBe(false);
    expect(isJyutping('蘇')).toBe(false);
    expect(isPinyin('Sū Zhúqíng')).toBe(true);
    expect(isPinyin('su1 zhu2 qing2')).toBe(true);
    expect(isPinyin('蘇竹晴')).toBe(false);
  });

  it('makes an ASCII slug with a suffix', () => {
    expect(slugFromName('Sū Zhúqíng', 'ab12')).toBe('su-zhuqing-ab12');
    expect(slugFromName('---', 'ab12')).toBe('person-ab12');
  });
});
