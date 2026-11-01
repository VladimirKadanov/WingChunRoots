// Text for a generated Open Graph image (milestone M11): only what its fonts draw (Noto Serif
// Display's Latin, Latin Extended, Greek and Cyrillic subsets): letters of those scripts, digits,
// punctuation, currency signs and spaces. Anything else is left out, because next/og fetches a
// font for a glyph its fonts lack from Google Fonts, and the app makes no such request.

export function drawable(text: string): string {
  return text
    .replace(/[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Nd}\p{P}\p{Zs}\p{Sc}+=]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
