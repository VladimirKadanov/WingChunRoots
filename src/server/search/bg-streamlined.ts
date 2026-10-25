// The Bulgarian Streamlined System (Обтекаема система, the official transliteration since 2009):
// "Тестов" → "testov", "Щерю" → "shteryu", "България" → "bulgaria". Hand-written rather than taken
// from a library, because `transliteration` follows Russian rules for щ, ъ and ия (docs/search.md).
// Search keys are lower case, so the result is too.

const LETTERS: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht',
  ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
  // Letters of other Cyrillic alphabets that a name written in Bulgarian may still carry.
  ё: 'yo', э: 'e', ы: 'y', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', ђ: 'dj', џ: 'dz',
};

/** Lower-case Latin letters for Bulgarian Cyrillic; other characters stay as they are. */
export function bgStreamlined(value: string): string {
  // Word-final "ия" is "ia" (България → Bulgaria); everywhere else я is "ya".
  const lower = value.normalize('NFC').toLowerCase().replace(/ия(?=$|[^\p{L}])/gu, 'ia');
  let out = '';
  for (const ch of lower) out += LETTERS[ch] ?? ch;
  return out;
}
