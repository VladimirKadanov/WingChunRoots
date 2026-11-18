// The control panel's two languages (owner request 2026-11-18, docs/adr/0043-admin-bulgarian.md):
// every /admin page in Bulgarian, with a switch to English, and only the control panel. The rest of
// the site stays English only (CLAUDE.md §2). No translation library: the English text in the
// components is the key, and a plain map gives its Bulgarian (src/components/admin/i18n/bg/*.ts).
// Text with no Bulgarian entry shows in English, and a unit test (bg/index.test.ts) fails for every
// t('…') literal under /admin that has none.
//
// Pure TypeScript: the server side (server.ts) reads the choice from a cookie, the client side
// (client.tsx) gets the same function from a context the admin layout fills.

export type AdminLang = 'bg' | 'en';

export const ADMIN_LANGS: readonly AdminLang[] = ['bg', 'en'];

/** The cookie that keeps a browser's choice (one year; not a secret, readable by scripts). */
export const ADMIN_LANG_COOKIE = 'wcr.admin_lang';

export type AdminDict = Readonly<Record<string, string>>;

export type Vars = Readonly<Record<string, string | number>>;

export function isAdminLang(value: unknown): value is AdminLang {
  return value === 'bg' || value === 'en';
}

export interface AdminT {
  /** `text` in the chosen language, with each {name} replaced by vars.name. */
  (text: string, vars?: Vars): string;
  /**
   * `text` where the same English means different things ("Open" the verb and "Open" the status):
   * the key is `context|text` (`t.x('verb', 'Open')` looks up "verb|Open"); English shows `text`.
   */
  x(context: string, text: string, vars?: Vars): string;
  readonly lang: AdminLang;
  /** The BCP 47 tag for lang attributes and Intl ('bg' or 'en'). */
  readonly locale: string;
  /**
   * A count with its noun: `t.n(3, '{n} case', '{n} cases')`. Both forms are dictionary keys; {n}
   * is the count, formatted for the language. Bulgarian, like English, has one form for 1 and
   * another for every other count.
   */
  n(count: number, one: string, other: string, vars?: Vars): string;
  /** A number formatted for the language ("1,234" or "1 234"). */
  num(value: number): string;
  /** "1 February 2026" or "1 февруари 2026", in UTC. */
  day(value: Date | string): string;
  /** "19 Oct 2026" or "19.10.2026", in UTC: for dense tables. */
  shortDay(value: Date | string): string;
}

function fill(text: string, vars: Vars | undefined): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const EN_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const BG_DAY = new Intl.DateTimeFormat('bg', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const EN_NUMBER = new Intl.NumberFormat('en');
const BG_NUMBER = new Intl.NumberFormat('bg');

const asDate = (value: Date | string) => (typeof value === 'string' ? new Date(value) : value);
const pad = (n: number) => String(n).padStart(2, '0');

/** The translating function for `lang`, looking Bulgarian text up in `dict`. */
export function makeAdminT(lang: AdminLang, dict: AdminDict): AdminT {
  const bg = lang === 'bg';
  const look = (text: string) => (bg ? (dict[text] ?? text) : text);
  const num = (value: number) => (bg ? BG_NUMBER : EN_NUMBER).format(value);
  const t = ((text: string, vars?: Vars) => fill(look(text), vars)) as AdminT;
  return Object.assign(t, {
    x: (context: string, text: string, vars?: Vars) => fill(bg ? (dict[`${context}|${text}`] ?? dict[text] ?? text) : text, vars),
    lang,
    locale: lang,
    n: (count: number, one: string, other: string, vars?: Vars) =>
      fill(look(count === 1 ? one : other), { ...vars, n: num(count) }),
    num,
    // Without the year's " г.", so a date can end a sentence ("… 2026.", not "… 2026 г..").
    day: (value: Date | string) => (bg ? BG_DAY.format(asDate(value)).replace(/\s*г\.$/, '') : EN_DAY.format(asDate(value))),
    shortDay: (value: Date | string) => {
      const d = asDate(value);
      return bg
        ? `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
        : `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    },
  });
}
