// The copy rule of CLAUDE.md §11 and plan §5.6 (milestone M08, In scope 7): no artificial urgency,
// scarcity, countdowns, shaming or FOMO. findFomo() returns every phrase of `text` that a rule
// below rejects; copy.no-fomo.test.ts runs it over the English text of src/app, src/components,
// src/server/templates and the services that write UI messages, and over a list of known-bad
// strings, so the check is shown to fail where it must. e2e/m08-entitlements.spec.ts runs it over
// the rendered upgrade prompt.
//
// Pure: no dependencies, no I/O. A new rule needs a known-bad example in the test.

export interface FomoRule {
  id: string;
  /** What the rule rejects, for the failure message. */
  why: string;
  pattern: RegExp;
}

const NUMBER = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|few)`;
const UNIT = String.raw`(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)`;

export const FOMO_RULES: readonly FomoRule[] = [
  {
    id: 'countdown',
    why: 'a countdown: time left before something ends',
    pattern: new RegExp(
      String.raw`\bcount-?down|\b${NUMBER}\s+${UNIT}\s+(?:left|remaining|to go)\b|\b(?:ends?|ending|expires?|expiring|closes?|closing)\s+in\s+${NUMBER}\b|\b\d{1,2}:\d{2}(?::\d{2})?\s+(?:left|remaining)\b|\btime\s+left\b`,
      'i',
    ),
  },
  {
    id: 'deadline',
    why: 'an artificial deadline',
    pattern:
      /\b(?:only|just)\s+today\b|\btoday\s+only\b|\b(?:offer|sale|deal|discount|price)s?\s+(?:ends?|expires?)\b|\b(?:ends?|ending|expires?|expiring)\s+(?:soon|tonight|today|at\s+midnight)\b|\blimited[-\s]time\b|\bfor\s+a\s+limited\s+time\b|\bbefore\s+it'?s\s+too\s+late\b|\bnow\s+or\s+never\b|\b(?:time|offer)\s+is\s+running\s+out\b|\brunning\s+out\s+of\s+time\b/i,
  },
  {
    id: 'urgency',
    why: 'pressure to act at once',
    pattern:
      /\bhurry\b|\blast\s+chance\b|\bact\s+(?:now|fast|quickly|today)\b|\b(?:upgrade|buy|subscribe|order|pay)\s+(?:now|today)\b|\bdon'?t\s+(?:wait|delay|miss(?:\s+out)?)\b|\bdo\s+not\s+(?:wait|miss(?:\s+out)?)\b|\bmiss(?:ing)?\s+out\b|\bwhy\s+wait\b|\bonce\s+in\s+a\s+lifetime\b|\bone[-\s]time\s+offer\b|\bfomo\b/i,
  },
  {
    id: 'scarcity',
    why: 'scarcity: few places or items left',
    pattern: new RegExp(
      String.raw`\b(?:only|just)\s+${NUMBER}\s+(?:spots?|places?|seats?|slots?|left|remaining|available)\b|\b${NUMBER}\s+(?:spots?|places?|seats?|slots?)\s+(?:left|remaining)\b|\bwhile\s+(?:stocks?|supplies|spots|places|seats)\s+lasts?\b|\b(?:selling|going)\s+fast\b|\balmost\s+(?:gone|full|sold\s+out)\b|\bsold\s+out\b|\blimited\s+(?:spots|places|seats|availability|offer)\b|\bexclusive\s+offer\b|\bhigh\s+demand\b`,
      'i',
    ),
  },
  {
    id: 'social-pressure',
    why: 'social pressure: others act, so should you',
    pattern:
      /\b\d+\s+(?:people|others|members|instructors|students)\s+(?:are\s+)?(?:viewing|looking|watching|upgrading|have\s+upgraded|joined\s+today)\b|\beveryone\s+(?:else\s+)?is\s+(?:upgrading|joining)\b|\b(?:others|everyone)\s+(?:are|is)\s+(?:already\s+)?(?:upgrading|ahead)\b/i,
  },
  {
    id: 'shaming',
    why: 'confirmshaming: a refusal worded to shame',
    pattern:
      /\bno\s+thanks,?\s+i\s+(?:don'?t|do\s+not)\s+(?:want|need|care|like)\b|\bi'?ll\s+(?:stay|remain)\s+(?:behind|basic|small)\b|\bi\s+(?:prefer|like)\s+to\s+(?:miss|lose|fall\s+behind)\b|\b(?:don'?t|do\s+not)\s+be\s+left\s+behind\b|\bfall(?:ing)?\s+behind\b/i,
  },
];

export interface FomoFinding {
  rule: string;
  why: string;
  /** The phrase that matched, as written. */
  match: string;
}

/** Every phrase of `text` that a rule of FOMO_RULES rejects (empty when the copy is fine). */
export function findFomo(text: string): FomoFinding[] {
  // Typographic apostrophes count like the plain one ("don’t hurry").
  const plain = text.replace(/[‘’ʼ]/g, "'");
  const findings: FomoFinding[] = [];
  for (const rule of FOMO_RULES) {
    const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const match of plain.matchAll(global)) findings.push({ rule: rule.id, why: rule.why, match: match[0] });
  }
  return findings;
}
