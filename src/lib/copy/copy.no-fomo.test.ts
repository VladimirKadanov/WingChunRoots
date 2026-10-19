// No artificial urgency, scarcity, countdowns, shaming or FOMO (milestone M08, In scope 7;
// CLAUDE.md §11, plan §5.6). The English text of the app is read from the source with the
// TypeScript parser (string and template literals, JSX text and attributes; never comments, which
// may state the rule itself) and checked with findFomo() (src/lib/copy/no-fomo.ts). The first two
// tests show that the matcher rejects known-bad copy and accepts the app's real copy, so the scan
// can fail; the scan itself must find nothing.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { FOMO_RULES, findFomo } from './no-fomo';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * Where the app's English copy lives: pages, components, e-mail and notification templates, the
 * services and plan matrix that write UI messages, and (review round 1, code-8) the auth, form and
 * RPC layers that return messages to clients and the shared helpers that format text (src/lib).
 */
const COPY_DIRS = [
  'src/app',
  'src/components',
  'src/server/templates',
  'src/server/services',
  'src/server/entitlements',
  'src/server/auth',
  'src/server/forms',
  'src/server/rpc',
  'src/lib',
];

/** Files that hold the banned phrases themselves, as data for the matcher. */
const NOT_COPY = new Set(['src/lib/copy/no-fomo.ts']);

/** The HTML entities JSX text may spell copy with, decoded before the check. */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&#xa0;': ' ',
  '&apos;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&quot;': '"',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&amp;': '&',
  '&mdash;': '—',
  '&ndash;': '–',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/** A number, an identifier or any other expression inside a sentence reads as "1". */
const PLACEHOLDER = '1';

/**
 * At most this many readings of one sentence: the product of what each expression in it can read
 * as (final check, code-2). Enough for a sentence with a few conditional plurals.
 */
const MAX_READINGS = 16;

interface CopyText {
  line: number;
  text: string;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Every distinct value, in order. */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The readings of a sentence made of parts, each with its candidate texts: their product, capped. */
function product(parts: string[][]): string[] {
  let readings = [''];
  for (const options of parts) {
    const next: string[] = [];
    for (const reading of readings) {
      for (const option of options) {
        if (next.length < MAX_READINGS) next.push(reading + option);
      }
    }
    readings = unique(next);
  }
  return readings;
}

/**
 * The texts of one source file: literals, template literals and JSX, with each JSX element's children joined into its sentence.
 *
 * An expression inside a sentence (a JSX expression, a template span, an operand of `+`) reads as
 * each text it can produce (final check, code-2): a string literal its text, a conditional either
 * branch, `??`, `||` and `&&` either operand, parentheses what they hold; anything else "1". So
 * `{n} {n === 1 ? 'day' : 'days'} left` is read as "1 day left" and "1 days left", and a countdown
 * written with the usual plural cannot slip through as "1 1 left".
 */
function copyOf(fileName: string, source: string): CopyText[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: CopyText[] = [];
  const push = (node: ts.Node, texts: string[]) => {
    for (const text of texts) {
      const value = collapse(text);
      if (value) out.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: value });
    }
  };
  const isPlus = (node: ts.Node): node is ts.BinaryExpression => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const EITHER = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken]);
  /** What an expression inside a sentence can read as (see copyOf). */
  const candidates = (node: ts.Expression): string[] => {
    if (ts.isParenthesizedExpression(node)) return candidates(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) return template(node);
    if (ts.isConditionalExpression(node)) return unique([...candidates(node.whenTrue), ...candidates(node.whenFalse)]);
    if (ts.isBinaryExpression(node) && EITHER.has(node.operatorToken.kind)) return unique([...candidates(node.left), ...candidates(node.right)]);
    if (isPlus(node)) return operand(node);
    return [PLACEHOLDER];
  };
  const template = (node: ts.TemplateExpression): string[] =>
    product([[node.head.text], ...node.templateSpans.flatMap((span) => [candidates(span.expression), [span.literal.text]])]);
  const jsxText = (node: ts.JsxElement | ts.JsxFragment): string[] =>
    product(
      node.children.map((child) => {
        if (ts.isJsxText(child)) return [decodeEntities(child.text)];
        if (ts.isJsxElement(child) || ts.isJsxFragment(child)) return jsxText(child);
        if (ts.isJsxExpression(child)) return child.expression ? candidates(child.expression) : [''];
        return [''];
      }),
    );
  /** One operand of a `+` chain as its readings: a literal's own text, any other expression its candidates. */
  const operand = (node: ts.Expression): string[] => {
    const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
    if (isPlus(inner)) return product([operand(inner.left), operand(inner.right)]);
    return candidates(inner);
  };
  const hasLiteral = (node: ts.Expression): boolean => {
    const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
    if (isPlus(inner)) return hasLiteral(inner.left) || hasLiteral(inner.right);
    return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner);
  };
  const visit = (node: ts.Node): void => {
    // Module paths are not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    // 'Last ' + 'chance' is one sentence: the whole chain, from its outermost `+`.
    if (isPlus(node) && !(node.parent && isPlus(node.parent)) && hasLiteral(node)) push(node, operand(node));
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node, [node.text]);
    else if (ts.isTemplateExpression(node)) push(node, template(node));
    else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) push(node, jsxText(node));
    else if (ts.isIdentifier(node) && /count-?down/i.test(node.text)) push(node, [node.text]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

function copyFiles(): string[] {
  return COPY_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes('__boundary-probe-'))
      .map((name) => join(ROOT, dir, name))
      .filter((file) => !NOT_COPY.has(relative(ROOT, file))),
  ).sort();
}

describe('findFomo()', () => {
  it('rejects countdowns, deadlines, urgency, scarcity, social pressure and shaming', () => {
    const bad: [string, string][] = [
      ['Only today: Professional Sifu for half the price', 'deadline'],
      ['Today only', 'deadline'],
      ['Hurry, the pilot is filling up', 'urgency'],
      ['Last chance to keep approving students', 'urgency'],
      ['Act now and approve every student', 'urgency'],
      ['Upgrade now', 'urgency'],
      ['Don’t miss out on Professional Sifu', 'urgency'],
      ['Do not wait', 'urgency'],
      ['Offer ends in 3 days', 'countdown'],
      ['2 days left to upgrade', 'countdown'],
      ['Expires in five minutes', 'countdown'],
      ['04:59 remaining', 'countdown'],
      ['Countdown', 'countdown'],
      ['Price ends tonight', 'deadline'],
      ['A limited-time price', 'deadline'],
      ['Before it’s too late', 'deadline'],
      ['Only 3 spots left', 'scarcity'],
      ['Just two places remaining', 'scarcity'],
      ['While spots last', 'scarcity'],
      ['Selling fast', 'scarcity'],
      ['12 instructors are upgrading right now', 'social-pressure'],
      ['Everyone else is upgrading', 'social-pressure'],
      ['No thanks, I don’t want more students', 'shaming'],
      ['I’ll stay small', 'shaming'],
      ['Don’t be left behind', 'shaming'],
    ];
    for (const [text, rule] of bad) {
      expect(
        findFomo(text).map((finding) => finding.rule),
        text,
      ).toContain(rule);
    }
    // Every rule is exercised by at least one example above.
    expect(new Set(bad.map(([, rule]) => rule))).toEqual(new Set(FOMO_RULES.map((rule) => rule.id)));
  });

  it('accepts the copy of the plans, the upgrade prompt and the dashboards', () => {
    const good = [
      'Not now',
      'Request pilot access',
      'Proposed price (not final)',
      'Proposed prices — not final. Payments are not available during the pilot.',
      'Planned — not available yet',
      'You have approved 5 of 5 students on Free Sifu.',
      'One student request waits below. It stays pending and visible.',
      '3 student requests wait below. They stay pending and visible.',
      'What Professional Sifu adds during the pilot',
      'Opens with teacher requests',
      'Opens with schools and the map',
      'Requests to teachers open later in the pilot; a request you send then waits here until the teacher answers it.',
      'You can change the type up to five times in 24 hours.',
      'You have changed your account type several times today. Try again tomorrow.',
      'There are no payments during the pilot. Request pilot access and an administrator can give you Professional Sifu as a test plan.',
      'The plan stops at 00:00 UTC that day. Leave empty for no end date.',
      'Confirmed links stay confirmed and public. New approvals above the remaining plan’s limit wait.',
      'Your request for Professional Sifu was sent to the administrators. An administrator either gives you the plan or closes the request, and you get a notification either way. Nothing is charged.',
      'Sent 3 days ago',
      'Mark all as read',
      'Students: 5 of 5 approved on Free Sifu',
      'An administrator ended your pilot plan Professional Sifu. Every confirmed link stays confirmed and public.',
    ];
    for (const text of good) expect(findFomo(text), text).toEqual([]);
  });
});

describe('copyOf()', () => {
  it('reads literals, template literals and JSX sentences, and skips comments and module paths', () => {
    const source = [
      "import { hurry } from './last-chance';",
      '// Hurry: a comment that states the rule is not copy.',
      '/* Only today, also a comment. */',
      'const a = `${n} days left`;',
      "const b = 'Fine copy';",
      'export const C = () => <p title="Act now">Only {n} spots left, <b>hurry</b></p>;',
      'const countdownTimer = 1;',
    ].join('\n');
    const texts = copyOf('probe.tsx', source).map((item) => item.text);
    expect(texts).toContain('1 days left');
    expect(texts).toContain('Fine copy');
    expect(texts).toContain('Act now');
    expect(texts).toContain('Only 1 spots left, hurry');
    expect(texts).toContain('countdownTimer');
    expect(texts.join(' | ')).not.toMatch(/comment|last-chance|Only today/);
    const rules = texts.flatMap((text) => findFomo(text).map((finding) => finding.rule));
    expect(new Set(rules)).toEqual(new Set(['countdown', 'urgency', 'scarcity']));
  });

  it('decodes entities in JSX text and reads a + chain as one sentence (review round 1, code-8)', () => {
    const source = [
      'export const A = () => <p>Last&nbsp;chance</p>;',
      'export const B = () => <p>Don&apos;t miss out</p>;',
      'export const C = () => <p>Act&#160;now</p>;',
      "const d = 'Last ' + 'chance';",
      "const e = 'Only ' + n + ' spots left';",
      "const f = ('Hurry' + ',') + ' please';",
    ].join('\n');
    const texts = copyOf('probe.tsx', source).map((item) => item.text);
    expect(texts).toContain('Last chance');
    expect(texts).toContain("Don't miss out");
    expect(texts).toContain('Act now');
    expect(texts).toContain('Only 1 spots left');
    expect(texts).toContain('Hurry, please');
    const rules = texts.flatMap((text) => findFomo(text).map((finding) => finding.rule));
    expect(new Set(rules)).toEqual(new Set(['urgency', 'scarcity']));
    expect(texts.filter((text) => findFomo(text).length > 0).length).toBeGreaterThanOrEqual(5);
  });
});

describe('copyOf(): conditional plurals and fallbacks (final check, code-2)', () => {
  it('reads each branch of a conditional, so a countdown or scarcity written with a plural is caught', () => {
    const source = [
      "export const A = () => <p>{days} {days === 1 ? 'day' : 'days'} left</p>;",
      "export const B = () => <p>Only {n} {n === 1 ? 'place' : 'places'} left in the pilot</p>;",
      "const c = `${days} ${days === 1 ? 'hour' : 'hours'} remaining`;",
      "const d = 'Only ' + n + (n === 1 ? ' spot' : ' spots') + ' left';",
      "export const E = () => <p>{label ?? 'Hurry'}, {flag && 'act now'}</p>;",
    ].join('\n');
    const texts = copyOf('probe.tsx', source).map((item) => item.text);
    expect(texts).toContain('1 day left');
    expect(texts).toContain('1 days left');
    expect(texts).toContain('Only 1 places left in the pilot');
    expect(texts).toContain('1 hours remaining');
    expect(texts).toContain('Only 1 spots left');
    const flagged = (line: string) => texts.filter((text) => text.startsWith(line) && findFomo(text).length > 0);
    // Each of the three sentences of the review, and the + chain, is flagged.
    expect(flagged('1 day').map((text) => findFomo(text)[0]!.rule)).toContain('countdown');
    expect(flagged('Only 1 place').map((text) => findFomo(text)[0]!.rule)).toContain('scarcity');
    expect(flagged('1 hour').map((text) => findFomo(text)[0]!.rule)).toContain('countdown');
    expect(flagged('Only 1 spot').map((text) => findFomo(text)[0]!.rule)).toContain('scarcity');
    // ?? and && read either side.
    expect(texts).toEqual(expect.arrayContaining(['Hurry, act now', '1, 1']));
    expect(findFomo('Hurry, act now').map((finding) => finding.rule)).toContain('urgency');
  });

  it('caps the readings of one sentence', () => {
    const many = Array.from({ length: 6 }, (_, i) => `{x${i} ? 'a' : 'b'}`).join(' ');
    const texts = copyOf('probe.tsx', `export const A = () => <p>${many}</p>;`).filter((item) => item.line === 1 && item.text.length > 1);
    expect(texts.length).toBeLessThanOrEqual(MAX_READINGS);
    expect(texts.length).toBeGreaterThan(1);
  });
});

describe('the English copy of the app', () => {
  it('has no countdown, urgency, scarcity, social pressure or shaming', () => {
    const files = copyFiles();
    // The scan covers the screens of M08; an empty or wrong folder list cannot pass.
    const names = files.map((file) => relative(ROOT, file));
    expect(names).toEqual(
      expect.arrayContaining([
        'src/components/plans/upgrade-prompt.tsx',
        'src/app/plans/page.tsx',
        'src/server/templates/notifications.ts',
        'src/server/auth/guards.ts',
        'src/server/forms/flash.ts',
        'src/server/rpc/form.ts',
        'src/lib/dates.ts',
      ]),
    );
    expect(names).not.toContain('src/lib/copy/no-fomo.ts');
    expect(files.length).toBeGreaterThan(50);

    const findings = files.flatMap((file) =>
      copyOf(file, readFileSync(file, 'utf8')).flatMap(({ line, text }) =>
        findFomo(text).map((finding) => `${relative(ROOT, file)}:${line} ${finding.rule} ("${finding.match}"): ${finding.why}`),
      ),
    );
    expect([...new Set(findings)]).toEqual([]);
  });
});
