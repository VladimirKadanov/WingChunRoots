// Search keys (milestone M07, In scope 2; plan §5.3, §6.2): every stored name of a person gives a
// few normalised strings that the search matches, so a person is found by every spelling: Latin
// letters without diacritics, Cyrillic and its Latin transliteration (the Bulgarian Streamlined
// System for Bulgarian, `transliteration` for other Cyrillic), Chinese characters folded to one
// form (Traditional and Simplified alike, `opencc-js`), pinyin (`pinyin-pro`) and Jyutping
// (`to-jyutping`) without tones, and the Hong Kong spellings of Jyutping (./aliases.ts).
//
// Pure functions: the store (./store.ts) writes the keys of a person whenever its names change,
// and the search (./query.ts) runs the query through the same normalisation. A key is never shown
// to anyone: a match shows the stored name it came from (person_name), never the key itself.

import ToJyutping from 'to-jyutping';
import { Converter } from 'opencc-js/t2cn';
import { pinyin } from 'pinyin-pro';
import { transliterate } from 'transliteration';

import type { NAME_KEY_KINDS } from '../db/schema/common';
import { hongKongSpellings } from './aliases';
import { bgStreamlined } from './bg-streamlined';

export type KeyKind = (typeof NAME_KEY_KINDS)[number];

/** A stored name, as person_name has it. */
export interface NameForKeys {
  value: string;
  script: string;
  lang: string;
  kind: string;
  romanization: string | null;
}

export interface GeneratedKey {
  key: string;
  keyKind: KeyKind;
  /** How the key was made: `name` (the name itself), a library, a rule or an alias table. */
  source: string;
}

/** Keys longer than this are cut: no name is that long (NAME_MAX_LENGTH is 120). */
const MAX_KEY_LENGTH = 200;

const HAN = /\p{Script=Han}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;
/** A letter of a script with no rules of its own here (Greek, Hangul, kana, Arabic, ...). */
const OTHER_SCRIPT = /(?![\p{Script=Latin}\p{Script=Han}\p{Script=Cyrillic}])\p{L}/u;

// Latin letters that NFKD does not take apart.
const LATIN_FOLDS: Readonly<Record<string, string>> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i', ŋ: 'ng', ʼ: '', ˈ: '',
};

// Traditional (Hong Kong and Taiwan forms) → Simplified (mainland): both spellings of a name fold
// to one key. Created once; the dictionaries load on first use.
let toSimplified: ((s: string) => string) | null = null;
function foldHan(value: string): string {
  toSimplified ??= Converter({ from: 'hk', to: 'cn' });
  // Taiwan forms that the Hong Kong table leaves as they are (台/臺) fold too.
  return [...toSimplified(value)].filter((ch) => HAN.test(ch)).join('');
}

/**
 * Lower-case Latin letters and digits, words separated by single spaces: diacritics and tone
 * marks removed ("Sū Qínglán" → "su qinglan"), apostrophes, hyphens and dots read as spaces.
 */
export function foldLatin(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, (ch) => LATIN_FOLDS[ch] ?? ' ')
    .replace(/\p{L}/gu, (ch) => LATIN_FOLDS[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEY_LENGTH);
}

/** Tone numbers of Jyutping (1–6) and pinyin (1–5) after a letter: "sou1 cing4" → "sou cing". */
export function stripToneNumbers(value: string): string {
  return value.replace(/(?<=\p{L})[1-6](?=\s|$|[^\p{N}])/gu, '').replace(/\s+/g, ' ').trim();
}

/** Lower-case Cyrillic with ё read as е, separators as single spaces. */
function foldCyrillic(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEY_LENGTH);
}

/** Toneless pinyin of Chinese characters, syllables separated by spaces ("蘇晴嵐" → "su qing lan"). */
function pinyinOf(han: string): string {
  // Surname mode: the first character is read as a surname (曾 is zēng, not céng).
  return foldLatin(pinyin(han, { toneType: 'none', surname: 'head', nonZh: 'removed' }));
}

/** Toneless Jyutping of Chinese characters ("蘇晴嵐" → "sou cing laam"); characters it does not know are left out. */
function jyutpingOf(han: string): string {
  return stripToneNumbers(
    ToJyutping.getJyutpingList(han)
      .map(([, reading]) => reading ?? '')
      .filter(Boolean)
      .join(' '),
  );
}

/** Whether a name in Chinese characters may be read as Chinese (pinyin, Jyutping). */
function isChineseName(name: NameForKeys): boolean {
  return ['Hant', 'Hans', 'Hani'].includes(name.script) || /^(zh|yue|lzh|wuu|hak|nan|cmn)(-|$)/.test(name.lang);
}

/** The Hong Kong spellings of a toneless Jyutping string: the first spelling of each syllable, and each spelling of the first. */
function hongKongKeys(jyutping: string): string[] {
  const syllables = jyutping.split(' ').filter(Boolean);
  const spelt = syllables.map((s) => hongKongSpellings(s));
  if (spelt.length === 0 || spelt.some((options) => options.length === 0)) return [];
  const rest = spelt.slice(1).map((options) => options[0]!);
  return spelt[0]!.map((first) => [first, ...rest].join(' '));
}

/**
 * The keys of one stored name. The same key never appears twice; a multi-syllable romanization
 * also gets its form without spaces ("qing lan" and "qinglan" are the same name).
 */
export function keysForName(name: NameForKeys): GeneratedKey[] {
  const out: GeneratedKey[] = [];
  const seen = new Set<string>();
  const add = (key: string, keyKind: KeyKind, source: string, compact = false) => {
    const variants = compact && key.includes(' ') ? [key, key.replaceAll(' ', '')] : [key];
    for (const k of variants) {
      const id = `${keyKind}\u0000${k}`;
      if (!k || seen.has(id)) continue;
      seen.add(id);
      out.push({ key: k, keyKind, source });
    }
  };
  const value = name.value.normalize('NFC');

  if (HAN.test(value) && isChineseName(name)) {
    add(foldHan(value), 'han', 'opencc-js');
    const jyutping = jyutpingOf(value);
    add(pinyinOf(value), 'pinyin', 'pinyin-pro', true);
    add(jyutping, 'jyutping', 'to-jyutping', true);
    for (const hk of hongKongKeys(jyutping)) add(hk, 'alias', 'alias:hk-spelling', true);
  } else if (HAN.test(value)) {
    // Japanese or Korean names written partly in Chinese characters: matched by the characters only.
    add(foldHan(value), 'han', 'opencc-js');
  }

  if (CYRILLIC.test(value)) {
    add(foldCyrillic(value), 'cyrillic', 'name');
    // Bulgarian (or no language tag): the Streamlined System first; then the general rules, which
    // read a Russian or Ukrainian name the way it is usually spelt in Latin letters.
    if (/^(bg|und)(-|$)/.test(name.lang)) add(foldLatin(bgStreamlined(value)), 'latin', 'bg_streamlined');
    add(foldLatin(transliterate(value)), 'latin', 'transliteration');
  }

  if (LATIN.test(value)) {
    const folded = foldLatin(name.romanization === 'jyutping' || name.romanization === 'pinyin' ? stripToneNumbers(value) : value);
    if (name.romanization === 'jyutping') {
      add(folded, 'jyutping', 'name', true);
      for (const hk of hongKongKeys(folded)) add(hk, 'alias', 'alias:hk-spelling', true);
    } else if (name.romanization === 'pinyin') {
      add(folded, 'pinyin', 'name', true);
    } else {
      add(folded, 'latin', 'name', name.romanization === 'hk_gov' || name.romanization === 'yale');
    }
  } else if (!HAN.test(value) && !CYRILLIC.test(value)) {
    // Any other script (Greek, Thai, Hebrew, Arabic, ...): its usual Latin transliteration.
    add(foldLatin(transliterate(value)), 'latin', 'transliteration');
  }
  return out;
}

/** The strings a query is matched with; `han` marks the Chinese-character form. */
export interface QueryForm {
  text: string;
  han: boolean;
}

/** The longest query the search accepts (the procedure refuses longer input). */
export const MAX_QUERY_LENGTH = 100;

/**
 * The forms of a search query, through the same normalisation as the keys: Chinese characters
 * folded to one form; Latin letters without diacritics and tone numbers (and without spaces);
 * Cyrillic as it is and in Latin letters (Streamlined System, then the general rules). Empty when
 * the query has nothing to search for.
 */
export function queryForms(query: string): QueryForm[] {
  const value = query.normalize('NFKC').slice(0, MAX_QUERY_LENGTH);
  const forms: QueryForm[] = [];
  const add = (text: string, han = false) => {
    if (text && !forms.some((f) => f.text === text)) forms.push({ text, han });
  };
  if (HAN.test(value)) add(foldHan(value), true);
  if (CYRILLIC.test(value)) {
    add(foldCyrillic(value));
    add(foldLatin(bgStreamlined(value)));
    add(foldLatin(transliterate(value)));
  }
  // Any other script (Greek, Hangul, kana, Arabic, ...): its usual Latin transliteration, the form
  // keysForName() keys such a name by.
  if (OTHER_SCRIPT.test(value)) add(foldLatin(transliterate(value.replace(/[\p{Script=Han}\p{Script=Cyrillic}]/gu, ' '))));
  const latin = foldLatin(stripToneNumbers(value.replace(/[\p{Script=Han}\p{Script=Cyrillic}]/gu, ' ')));
  if (LATIN.test(latin)) {
    add(latin);
    add(latin.replaceAll(' ', ''));
  }
  return forms;
}
