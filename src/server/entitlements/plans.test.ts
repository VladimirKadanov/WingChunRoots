// The plan matrix matches specification §3.1 for the five plans (M08, Done when 2): every cell of
// the English table in docs/WingChunRoots_Project_Specification.en.md, word for word, and the
// shape and numbers of the Bulgarian table. A change of the specification fails here until the
// matrix (and PLAN_MATRIX_VERSION) follows it.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLAN_CODES } from '../db/schema/common';
import {
  DOWNGRADE_RULES,
  FEATURE_KEYS,
  FEATURES,
  FEDERATION_EXTRAS,
  formatPrice,
  FREE_SIFU_STUDENT_LIMIT,
  freePlanFor,
  GRANTABLE_PLANS,
  PLAN_MATRIX_VERSION,
  PLAN_ORDER,
  PLANS,
  PLANS_WITHOUT_PILOT_BENEFITS,
  plansFor,
  upgradeBenefits,
  valueMark,
} from './plans';

/** The rows of the first Markdown table after `heading`, split into trimmed cells. */
function tableAfter(file: string, heading: RegExp): string[][] {
  const lines = readFileSync(resolve(file), 'utf8').split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  expect(start, `${file}: heading ${heading}`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) rows.push(line.slice(1, -1).split('|').map((cell) => cell.trim()));
    else if (rows.length > 0) break;
  }
  // Drop the | --- | separator.
  return rows.filter((row) => !row.every((cell) => /^-+$/.test(cell)));
}

const en = tableAfter('docs/WingChunRoots_Project_Specification.en.md', /^### 3\.1 /);
const bg = tableAfter('docs/WingChunRoots_Project_Specification.bg.md', /^### 3\.1 /);

describe('the plan matrix against specification §3.1 (English)', () => {
  it('has the five plans in the order and with the tiers of the specification', () => {
    const header = en[0]!.slice(1);
    expect(header).toHaveLength(5);
    expect(PLAN_ORDER).toEqual([...PLAN_CODES]);
    PLAN_ORDER.forEach((code, i) => expect(header[i]).toBe(`${PLANS[code].tier} ${PLANS[code].name}`));
  });

  it('has the proposed monthly prices of the specification (DEFAULT D09)', () => {
    const row = en.find((r) => r[0] === 'Proposed monthly price')!;
    expect(row.slice(1)).toEqual(PLAN_ORDER.map((code) => `$${PLANS[code].price.monthlyUsd}`));
    for (const code of PLAN_ORDER) expect(PLANS[code].price.status).toBe('working proposal');
    expect(PLANS.federation.price.yearlyUsd).toBe(990);
  });

  it('has one feature for every other row, in the same order, with every cell word for word', () => {
    const rows = en.slice(1).filter((r) => r[0] !== 'Proposed monthly price');
    expect(FEATURES.map((f) => f.source)).toEqual(rows.map((r) => r[0]));
    expect(FEATURES.map((f) => f.key)).toEqual([...FEATURE_KEYS]);
    for (const [i, f] of FEATURES.entries()) {
      expect(PLAN_ORDER.map((code) => f.values[code].source), f.key).toEqual(rows[i]!.slice(1));
    }
  });

  it('lists the Tier 4 extras named below the table', () => {
    const text = readFileSync(resolve('docs/WingChunRoots_Project_Specification.en.md'), 'utf8');
    expect(text).toContain('Tier 4 includes bulk CSV/Excel import, digital certificate issuance, organization analytics by country and city, and administration of affiliated schools.');
    expect(FEDERATION_EXTRAS).toHaveLength(4);
  });
});

describe('the plan matrix against specification §3.1 (Bulgarian)', () => {
  it('has the same shape: a header, the price row and one row per feature', () => {
    expect(bg).toHaveLength(en.length);
    for (const row of bg) expect(row).toHaveLength(6);
  });

  it('has the same prices and numbers, and Yes/No where the English table has them', () => {
    const numbers = (cell: string) => cell.match(/\d+/g)?.join(',') ?? '';
    for (let r = 1; r < en.length; r++) {
      for (let c = 1; c < 6; c++) {
        const english = en[r]![c]!;
        const bulgarian = bg[r]![c]!;
        expect(numbers(bulgarian), `row ${r}, column ${c}`).toBe(numbers(english));
        if (english === 'Yes') expect(bulgarian, `row ${r}, column ${c}`).toBe('Да');
        if (english === 'No') expect(bulgarian, `row ${r}, column ${c}`).toBe('Не');
      }
    }
  });
});

describe('availability, quotas and enforcement (plan §6.5)', () => {
  it('marks the features that do not exist in the pilot as planned', () => {
    // Plan §6.5: galleries, video, events, listings, the digital successor, posters and almanacs.
    for (const key of ['photos', 'videos', 'events', 'marketplace', 'successor', 'poster', 'almanac', 'passport', 'school_business'] as const) {
      expect(FEATURES.find((f) => f.key === key)!.availability, key).toBe('planned');
    }
    for (const f of FEATURES) {
      if (f.availability === 'now') expect(f.phase, f.key).toBeNull();
      else expect(f.phase, f.key).toBeGreaterThanOrEqual(2);
    }
  });

  it('enforces exactly the two rules of Phase 1: approved students (D06) and the school pin', () => {
    expect(FEATURES.filter((f) => f.enforced).map((f) => f.key)).toEqual(['approve_students', 'school_map']);
    for (const f of FEATURES.filter((x) => x.enforced)) expect(f.availability).toBe('now');
  });

  it('records the approval quota of D06 and the media quotas of D07', () => {
    const limits = (key: string) => PLAN_ORDER.map((code) => FEATURES.find((f) => f.key === key)!.values[code].limit);
    expect(limits('approve_students')).toEqual([0, 0, 5, null, null]);
    // The screens name the limit through FREE_SIFU_STUDENT_LIMIT (final check, code-3): the same number.
    expect(FREE_SIFU_STUDENT_LIMIT).toBe(FEATURES.find((f) => f.key === 'approve_students')!.values.free_sifu.limit);
    expect(limits('photos')).toEqual([1, 10, 2, 100, null]);
    expect(limits('videos')).toEqual([0, 2, 0, 20, null]);
    expect(DOWNGRADE_RULES.enforcedInPhase1).toBe(false);
  });

  it('takes the free plan from the account type', () => {
    expect(freePlanFor('student')).toBe('free_student');
    expect(freePlanFor('sifu')).toBe('free_sifu');
    expect(plansFor('sifu').map((p) => p.code)).toEqual(['free_sifu', 'pro_sifu']);
    expect(plansFor('student').map((p) => p.code)).toEqual(['free_student', 'premium_student']);
  });

  it('lets an admin grant only plans that exist in the pilot', () => {
    for (const code of GRANTABLE_PLANS) {
      expect(PLANS[code].availability).toBe('now');
      expect(PLANS[code].rank).toBeGreaterThan(0);
    }
    expect(GRANTABLE_PLANS).not.toContain('federation');
  });

  it('formats a proposed price: monthly, the yearly proposal where there is one, and "Free" (review round 1, code-5, design-10)', () => {
    expect(formatPrice(PLANS.pro_sifu.price)).toBe('$19 a month');
    expect(formatPrice(PLANS.premium_student.price)).toBe('$4 a month');
    expect(formatPrice(PLANS.federation.price)).toBe('$99 a month or $990 a year');
    expect(formatPrice(PLANS.free_sifu.price)).toBe('Free');
    expect(formatPrice(PLANS.free_student.price)).toBe('Free');
  });

  it('versions the matrix', () => {
    expect(PLAN_MATRIX_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  // Review round 1, code-7: any change of a plan, a price, a label, a limit or an availability
  // changes this digest. When it fails: bump PLAN_MATRIX_VERSION, say what changed in
  // docs/entitlements.md ("Версии на матрицата"), then pin the new version and digest here.
  it('pins the version to the content of the matrix', () => {
    const digest = createHash('sha256')
      .update(JSON.stringify({ PLANS, FEATURES, GRANTABLE_PLANS, FEDERATION_EXTRAS, DOWNGRADE_RULES }))
      .digest('hex');
    expect({ version: PLAN_MATRIX_VERSION, digest }).toEqual({ version: '2026-10-19.1', digest: '15ec4f54b05f90bc56dda43feff21813c4f376ec2e45de985104cf6a3ea4f534' });
  });
});

describe('how /plans marks a value (review round 1, design-4)', () => {
  it('"Ads shown" is a lack and "No ads" the benefit: a check never sits next to ads', () => {
    const advertising = FEATURES.find((f) => f.key === 'advertising')!;
    for (const code of PLAN_ORDER) {
      const value = advertising.values[code];
      expect(valueMark(value), `${code}: ${value.label}`).toBe(value.label === 'Ads shown' ? 'not_included' : 'included');
    }
  });

  it('"Browse only" is a plain fact, neither a check nor a dash; a missing school pin is a lack', () => {
    const map = FEATURES.find((f) => f.key === 'school_map')!;
    expect(valueMark(map.values.free_student)).toBe('neutral');
    expect(valueMark(map.values.premium_student)).toBe('neutral');
    expect(valueMark(map.values.free_sifu)).toBe('not_included');
    expect(valueMark(map.values.pro_sifu)).toBe('included');
  });
});

describe('features of the pilot that are not built yet (review round 1, requirements-1, design-1)', () => {
  it('say when they open, and only features of the pilot do', () => {
    const opening = FEATURES.filter((f) => f.opens !== undefined);
    expect(opening.map((f) => [f.key, f.opens])).toEqual([
      ['claim_teachers', 'Opens with teacher requests'],
      ['approve_students', 'Opens with teacher requests'],
      ['school_map', 'Opens with schools and the map'],
    ]);
    for (const f of opening) expect(f.availability, f.key).toBe('now');
  });

  it('every benefit of an upgrade carries its opening note', () => {
    expect(upgradeBenefits('free_sifu', 'pro_sifu').map((b) => b.opens)).toEqual(['Opens with teacher requests', 'Opens with schools and the map']);
  });

  it('Premium Student gives nothing of the pilot over Free Student; the grant form says so (requirements-2)', () => {
    expect(upgradeBenefits('free_student', 'premium_student')).toEqual([]);
    expect(PLANS_WITHOUT_PILOT_BENEFITS).toEqual(['premium_student']);
  });
});

describe('upgradeBenefits() lists only real benefits (plan §5.6)', () => {
  it('Free Sifu to Professional Sifu: no student limit and a school pin, nothing planned', () => {
    const benefits = upgradeBenefits('free_sifu', 'pro_sifu');
    expect(benefits.map((b) => b.feature)).toEqual(['approve_students', 'school_map']);
    expect(benefits[0]).toMatchObject({ from: 'Up to 5 students', to: 'No limit', opens: 'Opens with teacher requests' });
  });

  it('never lists a planned feature, for any pair of plans', () => {
    const planned = new Set(FEATURES.filter((f) => f.availability === 'planned').map((f) => f.key));
    for (const from of PLAN_ORDER) {
      for (const to of PLAN_ORDER) {
        for (const benefit of upgradeBenefits(from, to)) expect(planned.has(benefit.feature), `${from} → ${to}: ${benefit.feature}`).toBe(false);
      }
    }
  });

  it('lists nothing for a move to the same or a lower plan', () => {
    expect(upgradeBenefits('pro_sifu', 'free_sifu')).toEqual([]);
    expect(upgradeBenefits('free_sifu', 'free_sifu')).toEqual([]);
  });
});
