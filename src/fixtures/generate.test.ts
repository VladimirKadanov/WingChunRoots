import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isUuidv7 } from '../server/db/ids';
import { RELATIONSHIP_STATUSES } from '../server/db/schema/common';
import {
  activeDuplicates,
  ANCHOR_PERSON_SLUGS,
  ANCHOR_SCHOOL_SLUGS,
  coversAllStatuses,
  FICTIONAL_MARK,
  fixtureStats,
  generateFixtures,
  LINEAGE_EXPORT_PATH,
  serializeLineageExport,
  STAT_RANGES,
  toLineageExport,
} from './generate';

const f = generateFixtures();
const stats = fixtureStats(f);
const personBySlug = new Map(f.persons.map((p) => [p.slug, p]));
const verifiedOrDisputed = (status: string) => status === 'verified' || status === 'in_arbitration';

describe('generateFixtures', () => {
  it('is deterministic: the same seed gives the same rows', () => {
    expect(JSON.stringify(generateFixtures())).toBe(JSON.stringify(f));
  });

  it('gives different data for another seed', () => {
    expect(generateFixtures(7).persons[10]!.id).not.toBe(f.persons[10]!.id);
  });

  it('has 550–650 people in 3 lineages and two hubs with at least 120 students', () => {
    expect(stats.persons).toBeGreaterThanOrEqual(STAT_RANGES.persons[0]);
    expect(stats.persons).toBeLessThanOrEqual(STAT_RANGES.persons[1]);
    expect(stats.lineages).toBe(3);
    expect(stats.hubStudents['demo-hub-a']).toBeGreaterThanOrEqual(STAT_RANGES.hubStudentsMin);
    expect(stats.hubStudents['demo-hub-b']).toBeGreaterThanOrEqual(STAT_RANGES.hubStudentsMin);
  });

  it('keeps the share of converging, cross-lineage and historical-only people in range', () => {
    const share = (n: number) => n / stats.persons;
    expect(share(stats.twoTeachersSameLineage)).toBeGreaterThanOrEqual(STAT_RANGES.twoTeachersSameLineage[0]);
    expect(share(stats.twoTeachersSameLineage)).toBeLessThanOrEqual(STAT_RANGES.twoTeachersSameLineage[1]);
    expect(share(stats.crossLineage)).toBeGreaterThanOrEqual(STAT_RANGES.crossLineage[0]);
    expect(share(stats.crossLineage)).toBeLessThanOrEqual(STAT_RANGES.crossLineage[1]);
    expect(share(stats.historicalOnly)).toBeGreaterThanOrEqual(STAT_RANGES.historicalOnly[0]);
    expect(share(stats.historicalOnly)).toBeLessThanOrEqual(STAT_RANGES.historicalOnly[1]);
  });

  it('has at least one relationship in every status of plan §6.7', () => {
    expect(coversAllStatuses(f)).toBe(true);
    expect(stats.statuses).toEqual([...RELATIONSHIP_STATUSES].sort());
  });

  it('has no duplicate active relationship and no self relationship', () => {
    expect(activeDuplicates(f)).toBe(0);
    expect(f.relationships.every((r) => r.teacherPersonId !== r.studentPersonId)).toBe(true);
  });

  it('has an acyclic teacher graph', () => {
    const students = new Map<string, string[]>();
    for (const r of f.relationships) students.set(r.teacherPersonId, [...(students.get(r.teacherPersonId) ?? []), r.studentPersonId]);
    const state = new Map<string, 'open' | 'done'>();
    const visit = (id: string): void => {
      if (state.get(id) === 'done') return;
      if (state.get(id) === 'open') throw new Error(`cycle through ${id}`);
      state.set(id, 'open');
      for (const s of students.get(id) ?? []) visit(s);
      state.set(id, 'done');
    };
    expect(() => f.persons.forEach((p) => visit(p.id))).not.toThrow();
  });

  it('marks every record as fictional (D20)', () => {
    const slugs = [...f.persons, ...f.lineages, ...f.schools, ...f.organizations].map((x) => x.slug);
    expect(slugs.every((s) => s.startsWith('demo-'))).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(f.personBios).toHaveLength(f.persons.length);
    expect(f.personBios.every((b) => b.body.includes(FICTIONAL_MARK))).toBe(true);
    expect(f.invitations.every((i) => i.email.endsWith('@example.test'))).toBe(true);
  });

  it('gives every person exactly one primary name, in Latin script', () => {
    for (const p of f.persons) {
      const primary = f.personNames.filter((n) => n.personId === p.id && n.isPrimary);
      expect(primary, p.slug).toHaveLength(1);
      expect(primary[0]!.script).toBe('Latn');
      expect(primary[0]!.kind).toBe('name');
    }
  });

  it('has Chinese, Cyrillic, alias and romanized names', () => {
    expect(stats.cjkNamed).toBeGreaterThan(100);
    expect(stats.simplifiedNamed).toBeGreaterThan(20);
    expect(stats.cyrillicNamed).toBeGreaterThanOrEqual(3);
    expect(stats.aliases).toBeGreaterThan(0);
    expect(stats.romanizations.jyutping).toBeGreaterThan(100);
    expect(stats.romanizations.pinyin).toBeGreaterThan(100);
  });

  it('makes a person public exactly when they have a public relationship (D03)', () => {
    const withPublic = new Set<string>();
    for (const r of f.relationships) {
      if (verifiedOrDisputed(r.status) && r.visibility === 'public') {
        withPublic.add(r.teacherPersonId);
        withPublic.add(r.studentPersonId);
      }
    }
    for (const p of f.persons) expect(p.visibility, p.slug).toBe(withPublic.has(p.id) ? 'public' : 'involved_only');
    // Requests that are not verified stay private.
    for (const r of f.relationships) {
      if (!['verified', 'in_arbitration', 'revoked'].includes(r.status)) expect(r.visibility).toBe('involved_only');
    }
  });

  it('keeps at most one display-primary established relationship per student (DEFAULT D05)', () => {
    const established = new Set(['verified', 'in_arbitration']);
    const counts = new Map<string, number>();
    for (const r of f.relationships) {
      if (r.isDisplayPrimary && established.has(r.status)) counts.set(r.studentPersonId, (counts.get(r.studentPersonId) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBe(1);
  });

  it('never marks a request as display-primary, so a hidden request cannot show (DEFAULT D05, D03)', () => {
    const requests = f.relationships.filter((r) => !['verified', 'in_arbitration', 'revoked'].includes(r.status));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.isDisplayPrimary)).toEqual([]);
    // Every public student with a single established relationship has it as the primary line.
    for (const slug of ['demo-historical-only', 'demo-latin-name', 'demo-arbitration'] as const) {
      const id = f.anchors[slug]!;
      const established = f.relationships.filter((r) => r.studentPersonId === id && ['verified', 'in_arbitration'].includes(r.status));
      expect(established.filter((r) => r.isDisplayPrimary), slug).toHaveLength(1);
    }
  });

  it('uses UUIDv7 ids', () => {
    expect([...f.persons, ...f.relationships, ...f.schools].every((x) => isUuidv7(x.id))).toBe(true);
  });

  it('records the status history of every relationship, ending in its current status', () => {
    for (const r of f.relationships) {
      const events = f.relationshipEvents.filter((e) => e.relationshipId === r.id);
      expect(events.length).toBeGreaterThan(0);
      expect(events.at(-1)!.toStatus).toBe(r.status);
      expect(events[0]!.fromStatus).toBeNull();
    }
  });
});

describe('anchor records', () => {
  const edgesOf = (slug: string, role: 'student' | 'teacher') => {
    const id = f.anchors[slug as keyof typeof f.anchors] ?? personBySlug.get(slug)!.id;
    return f.relationships.filter((r) => (role === 'student' ? r.studentPersonId : r.teacherPersonId) === id);
  };

  it('exist with fixed slugs', () => {
    for (const slug of ANCHOR_PERSON_SLUGS) expect(personBySlug.has(slug), slug).toBe(true);
    for (const slug of ANCHOR_SCHOOL_SLUGS) expect(f.schools.some((s) => s.slug === slug), slug).toBe(true);
  });

  it('demo-root-c is historical and demo-shared-ancestor teaches demo-root-a and demo-root-b', () => {
    expect(personBySlug.get('demo-root-c')!.kind).toBe('historical');
    expect(personBySlug.get('demo-shared-ancestor')!.kind).toBe('historical');
    const students = edgesOf('demo-shared-ancestor', 'teacher').map((r) => r.studentPersonId);
    expect(students).toEqual(expect.arrayContaining([f.anchors['demo-root-a'], f.anchors['demo-root-b']]));
  });

  it('demo-two-lineages has verified teachers and students in two lineages', () => {
    const teachers = edgesOf('demo-two-lineages', 'student').filter((r) => r.status === 'verified');
    expect(new Set(teachers.map((r) => r.lineageId)).size).toBe(2);
    const students = edgesOf('demo-two-lineages', 'teacher').filter((r) => r.status === 'verified');
    expect(new Set(students.map((r) => r.lineageId))).toEqual(new Set(teachers.map((r) => r.lineageId)));
  });

  it('demo-converging has two verified teachers in one lineage', () => {
    const teachers = edgesOf('demo-converging', 'student').filter((r) => r.status === 'verified');
    expect(teachers).toHaveLength(2);
    expect(teachers[0]!.lineageId).toBe(teachers[1]!.lineageId);
  });

  it('demo-historical-only has only ended relationships', () => {
    const rels = edgesOf('demo-historical-only', 'student');
    const ongoing = f.trainingPeriods.filter((p) => rels.some((r) => r.id === p.relationshipId) && p.ongoing);
    expect(rels.length).toBeGreaterThan(0);
    expect(ongoing).toHaveLength(0);
  });

  it('the status anchors have their status and stay private while not verified', () => {
    expect(edgesOf('demo-pending', 'student').map((r) => r.status)).toEqual(['pending_teacher']);
    expect(personBySlug.get('demo-pending')!.visibility).toBe('involved_only');
    expect(edgesOf('demo-under-review', 'student').map((r) => r.status)).toEqual(['under_review']);
    expect(edgesOf('demo-arbitration', 'student').map((r) => r.status)).toEqual(['in_arbitration']);
    const claimOnly = personBySlug.get('demo-claim-only-teacher')!;
    expect(claimOnly.visibility).toBe('involved_only');
    expect(edgesOf('demo-claim-only-teacher', 'teacher').map((r) => r.studentPersonId)).toEqual([f.anchors['demo-under-review']]);
  });

  it('the name anchors have the names they promise', () => {
    const names = (slug: string) => f.personNames.filter((n) => n.personId === personBySlug.get(slug)!.id);
    const cjk = names('demo-cjk-name');
    expect(cjk.map((n) => n.script)).toEqual(expect.arrayContaining(['Latn', 'Hant']));
    expect(cjk.map((n) => n.romanization)).toEqual(expect.arrayContaining(['jyutping', 'pinyin']));
    expect(names('demo-cyrillic-name').some((n) => n.script === 'Cyrl')).toBe(true);
    const latin = names('demo-latin-name');
    expect(latin.find((n) => n.isPrimary)!.value).toBe('Ivan Testov');
  });

  it('the quota anchors have 5 verified students plus one request, and 8 verified students', () => {
    const free = edgesOf('demo-free-sifu-5', 'teacher');
    expect(free.filter((r) => r.status === 'verified')).toHaveLength(5);
    expect(free.filter((r) => r.status === 'pending_teacher')).toHaveLength(1);
    const pro = edgesOf('demo-pro-sifu-8', 'teacher');
    expect(pro.filter((r) => r.status === 'verified')).toHaveLength(8);
    expect(pro).toHaveLength(8);
  });

  it('the school anchors: city-only privacy, and an instructor in two lineages', () => {
    const cityOnly = f.schools.find((s) => s.slug === 'demo-school-city-only')!;
    expect(cityOnly.locationPrivacy).toBe('city_only');
    const place = f.places.find((p) => p.id === cityOnly.placeId)!;
    expect(cityOnly.publicPoint).toEqual(place.centroid);
    const exact = f.schoolPrivateLocations.find((l) => l.schoolId === cityOnly.id)!;
    expect(exact.exactPoint).not.toEqual(place.centroid);
    const twoLineages = f.schools.find((s) => s.slug === 'demo-school-two-lineages')!;
    expect(f.schoolInstructors.filter((i) => i.schoolId === twoLineages.id).map((i) => i.personId)).toContain(
      f.anchors['demo-two-lineages'],
    );
  });

  it('every school is in a GeoNames city of the default countries', () => {
    const countries = new Set(f.places.filter((p) => f.schools.some((s) => s.placeId === p.id)).map((p) => p.countryCode));
    for (const c of countries) expect(['BG', 'GR', 'DE', 'GB', 'US', 'HK']).toContain(c);
  });
});

describe('lineage-600.json', () => {
  const exported = toLineageExport(f);

  it('is up to date with the generator (pnpm fixtures:generate)', () => {
    const file = readFileSync(path.join(process.cwd(), LINEAGE_EXPORT_PATH), 'utf8');
    expect(file === serializeLineageExport(exported)).toBe(true);
    expect(JSON.parse(file)).toEqual(JSON.parse(JSON.stringify(exported)));
  });

  it('has the shape of plan §6.3 and only public data', () => {
    expect(Object.keys(exported).slice(0, 5)).toEqual(['focusId', 'dataVersion', 'nodes', 'edges', 'hiddenCounts']);
    const nodeIds = new Set(exported.nodes.map((n) => n.id));
    expect(nodeIds.has(exported.focusId)).toBe(true);
    expect(nodeIds.has(f.anchors['demo-pending'])).toBe(false);
    expect(nodeIds.has(f.anchors['demo-claim-only-teacher'])).toBe(false);
    for (const e of exported.edges) {
      expect(['verified', 'in_arbitration']).toContain(e.status);
      expect(e.visibility).toBe('public');
      expect(nodeIds.has(e.teacherId) && nodeIds.has(e.studentId)).toBe(true);
      expect(['primary', 'converging', 'crossLineage']).toContain(e.kind);
      expect(e.periods.length).toBeGreaterThan(0);
    }
    const kinds = new Set(exported.edges.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['primary', 'converging', 'crossLineage']));
    for (const n of exported.nodes) {
      expect(Object.keys(n)).toEqual(['id', 'displayName', 'altNames', 'lifeStatus', 'claimState', 'lineageIds', 'childCount', 'hasMoreChildren']);
    }
  });
});
