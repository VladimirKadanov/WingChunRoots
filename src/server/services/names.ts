// Name input rules (plan §5.3; milestone M02, In scope 5): a Latin-script primary name is
// mandatory; an optional name in its original script carries a language tag that says which
// script it is; Jyutping and pinyin are romanizations. The checks are pure, so the form, the oRPC
// procedure and the tests share them.

export interface OriginalScript {
  /** BCP 47 tag stored in person_name.lang. */
  lang: string;
  /** ISO 15924 code stored in person_name.script. */
  script: string;
  /** The label in the form. */
  label: string;
  /** Unicode scripts its letters belong to. */
  letters: RegExp;
}

// The same tags as the demo data (src/fixtures/generate.ts).
export const ORIGINAL_SCRIPTS: readonly OriginalScript[] = [
  { lang: 'zh-Hant', script: 'Hant', label: 'Chinese, Traditional characters', letters: /\p{Script=Han}/u },
  { lang: 'zh-Hans', script: 'Hans', label: 'Chinese, Simplified characters', letters: /\p{Script=Han}/u },
  { lang: 'ja', script: 'Jpan', label: 'Japanese', letters: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u },
  { lang: 'ko', script: 'Kore', label: 'Korean', letters: /[\p{Script=Hangul}\p{Script=Han}]/u },
  { lang: 'bg-Cyrl', script: 'Cyrl', label: 'Bulgarian, Cyrillic', letters: /\p{Script=Cyrillic}/u },
  { lang: 'ru-Cyrl', script: 'Cyrl', label: 'Russian, Cyrillic', letters: /\p{Script=Cyrillic}/u },
  { lang: 'uk-Cyrl', script: 'Cyrl', label: 'Ukrainian, Cyrillic', letters: /\p{Script=Cyrillic}/u },
  { lang: 'sr-Cyrl', script: 'Cyrl', label: 'Serbian, Cyrillic', letters: /\p{Script=Cyrillic}/u },
  { lang: 'el', script: 'Grek', label: 'Greek', letters: /\p{Script=Greek}/u },
  { lang: 'th', script: 'Thai', label: 'Thai', letters: /\p{Script=Thai}/u },
  { lang: 'he', script: 'Hebr', label: 'Hebrew', letters: /\p{Script=Hebrew}/u },
  { lang: 'ar', script: 'Arab', label: 'Arabic', letters: /\p{Script=Arabic}/u },
];

export const NAME_MAX_LENGTH = 120;

/** Spaces collapsed, Unicode NFC. */
export function cleanName(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

// Separators that names use in any script: spaces, apostrophes, hyphens, dots, middle dots.
const SEPARATORS = String.raw`\s'’.\-·・`;
// Combining marks only from Script=Inherited (the accents of Latin letters): a mark of another
// script (a Devanagari nukta) is not Latin, and the e-mail templates refuse it in the display name.
const LATIN_NAME = new RegExp(String.raw`^[\p{Script=Latin}\p{Script=Inherited}${SEPARATORS}]+$`, 'u');
const LATIN_LETTER = /\p{Script=Latin}/u;

/** A name in Latin script: Latin letters with their accents and the usual separators only. */
export function isLatinName(value: string): boolean {
  const name = cleanName(value);
  return name.length > 0 && LATIN_NAME.test(name) && LATIN_LETTER.test(name);
}

export function originalScript(lang: string): OriginalScript | undefined {
  return ORIGINAL_SCRIPTS.find((s) => s.lang === lang);
}

/** Whether `value` is written in the script of `lang`: only its letters and separators. */
export function matchesScript(value: string, lang: string): boolean {
  const script = originalScript(lang);
  if (!script) return false;
  const name = cleanName(value);
  if (!name || !script.letters.test(name)) return false;
  return [...name].every((ch) => script.letters.test(ch) || /\p{M}/u.test(ch) || new RegExp(`[${SEPARATORS}]`, 'u').test(ch));
}

const JYUTPING = /^[a-z]+[1-6]?(?:[ -][a-z]+[1-6]?)*$/;

/** Jyutping in lower case with optional tone numbers: `sou1 zuk1 cing4`. */
export function isJyutping(value: string): boolean {
  return JYUTPING.test(cleanName(value).toLowerCase());
}

const PINYIN = /^[\p{Script=Latin}\p{M}0-9 '’-]+$/u;

/** Pinyin with tone marks or tone numbers: `Sū Zhúqíng`, `su1 zhu2 qing2`. */
export function isPinyin(value: string): boolean {
  const name = cleanName(value);
  return PINYIN.test(name) && LATIN_LETTER.test(name);
}

// --- The profile editor (milestone M07, In scope 1) ------------------------------------------------

/**
 * How a name is written, as the profile editor offers it: a script, a language tag and, for a
 * romanization, its system. The Latin forms come first; then every original script.
 */
export interface NameWriting {
  /** Stable id for the form's select. */
  id: string;
  label: string;
  script: string;
  lang: string;
  romanization: 'jyutping' | 'pinyin' | 'hk_gov' | null;
}

export const NAME_WRITINGS: readonly NameWriting[] = [
  // The language of a Latin-script name is not asked: `und-Latn` (BCP 47 "undetermined, Latin script").
  { id: 'latin', label: 'Latin letters', script: 'Latn', lang: 'und-Latn', romanization: null },
  { id: 'hk', label: 'Cantonese, Hong Kong spelling', script: 'Latn', lang: 'yue-Latn', romanization: 'hk_gov' },
  { id: 'jyutping', label: 'Cantonese, Jyutping', script: 'Latn', lang: 'yue-Latn', romanization: 'jyutping' },
  { id: 'pinyin', label: 'Mandarin, pinyin', script: 'Latn', lang: 'zh-Latn-pinyin', romanization: 'pinyin' },
  ...ORIGINAL_SCRIPTS.map((s) => ({ id: s.lang, label: s.label, script: s.script, lang: s.lang, romanization: null })),
];

/** BCP 47, as the person_name and person_bio CHECK constraints accept it. */
export const LANG_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/**
 * Whether `value` fits how the name says it is written: Latin letters (or Jyutping, or pinyin) for
 * Latin script, the letters of an original script for that script's language tag.
 */
export function nameFitsWriting(value: string, script: string, lang: string, romanization: string | null): boolean {
  if (script === 'Latn') {
    if (romanization === 'jyutping') return isJyutping(value);
    if (romanization === 'pinyin') return isPinyin(value);
    return isLatinName(value);
  }
  const known = originalScript(lang);
  return known !== undefined && known.script === script && romanization === null && matchesScript(value, lang);
}

/**
 * Why a name cannot be the display name (plan §5.3: the everyday spelling, in Latin letters), in
 * the words the editor's note and the save's error use, or null when it can be. Each reason says
 * what to change.
 */
export function displayNameRefusal(name: { kind: string; script: string; romanization: string | null }): string | null {
  if (name.romanization === 'jyutping' || name.romanization === 'pinyin' || name.kind === 'romanization') {
    return 'Jyutping and pinyin help people find you; your display name is your everyday spelling.';
  }
  if (name.kind === 'alias') return 'A name marked “Also known as” cannot be your display name.';
  if (name.script !== 'Latn') return 'Choose “Latin letters” or “Cantonese, Hong Kong spelling” under “Written in” to use this name.';
  return null;
}

/** A slug for a new person: the ASCII form of the Latin name and a random suffix. */
export function slugFromName(latinName: string, suffix: string): string {
  const base = cleanName(latinName)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return `${base || 'person'}-${suffix}`;
}
