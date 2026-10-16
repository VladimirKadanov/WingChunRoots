/**
 * Deterministic synthetic lineage data for the layout tests and the benchmark (M03).
 *
 * DEFAULT D20: only clearly fictional demo data. Every person is "Demo …", every slug starts
 * with `demo-`, the years are invented for invented people, and nothing refers to a real
 * person, lineage, date or rank.
 *
 * The graph has the shape of plan §6.3 and the anchor records of M01 under the same slugs:
 * `demo-root-a`, `demo-root-b`, `demo-shared-ancestor`, `demo-two-lineages`,
 * `demo-converging`, `demo-hub-a` (plus `demo-root-c` and `demo-hub-b`). About 600 people in
 * three lineages, two hubs with at least 120 students each, 6–10 % with two teachers in the
 * same lineage, 2–4 % with a teacher from another lineage and 1–3 % with historical
 * relationships only (plan §4.14: synthetic data underestimates real fan-out, hence hubs).
 *
 * The same seed always gives the same graph, byte for byte.
 */
import type {
  LineageEdge,
  LineageGraph,
  LineageNode,
  RelationshipStatus,
  TrainingPeriod,
} from '../types.ts';

export const DEFAULT_SEED = 20261016;

export const ANCHOR_SLUGS = [
  'demo-shared-ancestor',
  'demo-root-a',
  'demo-root-b',
  'demo-root-c',
  'demo-hub-a',
  'demo-hub-b',
  'demo-two-lineages',
  'demo-converging',
] as const;
export type AnchorSlug = (typeof ANCHOR_SLUGS)[number];

/** The anchor records whose ego views M03 measures and tests (milestone item 1). */
export const EGO_ANCHORS = [
  'demo-root-a',
  'demo-root-b',
  'demo-shared-ancestor',
  'demo-two-lineages',
  'demo-converging',
  'demo-hub-a',
] as const satisfies readonly AnchorSlug[];

export const LINEAGES = {
  a: 'demo-lineage-a',
  b: 'demo-lineage-b',
  c: 'demo-lineage-c',
} as const;

export interface SyntheticDataset {
  seed: number;
  /** The whole graph, nothing hidden. */
  graph: LineageGraph;
  /** Node id → slug, and slug → node id. */
  slugById: Record<string, string>;
  idBySlug: Record<string, string>;
}

export interface SyntheticOptions {
  seed?: number;
  /** People per lineage; the default gives about 600 in total. */
  lineageSizes?: { a: number; b: number; c: number };
  /** Students of each hub; at least 120 by default. */
  hubStudents?: number;
}

/** mulberry32: a small, fast, deterministic PRNG with a 32-bit state. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Person {
  id: string;
  slug: string;
  displayName: string;
  lineage: string;
  /** Generation index at creation (teachers are always created first). */
  depth: number;
  /** Fictional year in which the person started training. */
  startYear: number;
  historical: boolean;
}

/** Generates the synthetic dataset; the same options always give the same dataset. */
export function generateSyntheticLineage(options: SyntheticOptions = {}): SyntheticDataset {
  const seed = options.seed ?? DEFAULT_SEED;
  const sizes = options.lineageSizes ?? { a: 268, b: 214, c: 116 };
  const hubStudents = options.hubStudents ?? 124;
  const random = createRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  const people: Person[] = [];
  const bySlug = new Map<string, Person>();
  const edges: LineageEdge[] = [];
  const teachersOf = new Map<string, LineageEdge[]>();
  const studentsOf = new Map<string, LineageEdge[]>();
  let personCounter = 0;
  let edgeCounter = 0;

  const hex = (digits: number) => {
    let out = '';
    for (let i = 0; i < digits; i++) out += Math.floor(random() * 16).toString(16);
    return out;
  };
  // UUIDv7-shaped ids (version 7, RFC 9562 variant) drawn from the seeded PRNG.
  const newId = () => `${hex(8)}-${hex(4)}-7${hex(3)}-${'89ab'[int(0, 3)]}${hex(3)}-${hex(12)}`;

  const addPerson = (p: Omit<Person, 'id' | 'slug' | 'displayName'> & { slug?: string; displayName?: string }) => {
    personCounter++;
    const number = String(personCounter).padStart(3, '0');
    const person: Person = {
      ...p,
      id: newId(),
      slug: p.slug ?? `demo-person-${number}`,
      displayName: p.displayName ?? `Demo Person ${number}`,
    };
    people.push(person);
    bySlug.set(person.slug, person);
    teachersOf.set(person.id, []);
    studentsOf.set(person.id, []);
    return person;
  };

  const isAncestorOrSelf = (candidate: string, of: string): boolean => {
    // Is `candidate` reachable upwards from `of` (or equal to it)?
    const stack = [of];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === candidate) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of teachersOf.get(id)!) stack.push(e.teacherId);
    }
    return false;
  };

  const period = (from: number, historical: boolean): TrainingPeriod[] => {
    if (!historical) return [{ from: String(from), to: null, ongoing: true, precision: 'year' }];
    return [{ from: String(from), to: String(from + int(3, 12)), ongoing: false, precision: 'year' }];
  };

  const addEdge = (
    teacher: Person,
    student: Person,
    lineageId: string,
    kind: LineageEdge['kind'],
    extra: { status?: RelationshipStatus; isDisplayPrimary?: boolean; historical?: boolean } = {},
  ) => {
    if (isAncestorOrSelf(student.id, teacher.id)) {
      throw new Error(`synthetic generator would create a cycle: ${teacher.slug} -> ${student.slug}`);
    }
    edgeCounter++;
    const edge: LineageEdge = {
      id: `demo-edge-${String(edgeCounter).padStart(4, '0')}`,
      teacherId: teacher.id,
      studentId: student.id,
      lineageId,
      kind,
      status: extra.status ?? 'verified',
      isDisplayPrimary: extra.isDisplayPrimary ?? false,
      visibility: 'public',
      periods: period(student.startYear + (kind === 'primary' ? 0 : int(0, 4)), extra.historical ?? student.historical),
    };
    edges.push(edge);
    teachersOf.get(student.id)!.push(edge);
    studentsOf.get(teacher.id)!.push(edge);
    return edge;
  };

  const yearAt = (depth: number) => 1950 + depth * 9 + int(0, 6);
  const addStudent = (
    teacher: Person,
    lineageId: string,
    named: { slug?: string; displayName?: string } = {},
  ): Person => {
    const student = addPerson({
      ...named,
      lineage: lineageId,
      depth: teacher.depth + 1,
      startYear: yearAt(teacher.depth + 1),
      historical: false,
    });
    addEdge(teacher, student, lineageId, 'primary', { isDisplayPrimary: true });
    return student;
  };

  // --- Fixed skeleton with the anchor records -----------------------------------------
  const shared = addPerson({
    slug: 'demo-shared-ancestor',
    displayName: 'Demo Shared Ancestor',
    lineage: LINEAGES.a,
    depth: 0,
    startYear: 1920,
    historical: true,
  });
  const rootA = addPerson({ slug: 'demo-root-a', displayName: 'Demo Root A', lineage: LINEAGES.a, depth: 1, startYear: 1941, historical: true });
  const rootB = addPerson({ slug: 'demo-root-b', displayName: 'Demo Root B', lineage: LINEAGES.b, depth: 1, startYear: 1943, historical: true });
  const rootC = addPerson({ slug: 'demo-root-c', displayName: 'Demo Root C', lineage: LINEAGES.c, depth: 0, startYear: 1938, historical: true });
  addEdge(shared, rootA, LINEAGES.a, 'primary', { isDisplayPrimary: true, historical: true });
  addEdge(shared, rootB, LINEAGES.b, 'primary', { isDisplayPrimary: true, historical: true });

  const hubA = addStudent(rootA, LINEAGES.a, { slug: 'demo-hub-a', displayName: 'Demo Hub A' });
  const aGen2 = [hubA];
  for (let i = 0; i < 5; i++) aGen2.push(addStudent(rootA, LINEAGES.a));
  const bGen2: Person[] = [];
  for (let i = 0; i < 4; i++) bGen2.push(addStudent(rootB, LINEAGES.b));
  const hubB = addStudent(bGen2[0]!, LINEAGES.b, { slug: 'demo-hub-b', displayName: 'Demo Hub B' });
  const cGen1: Person[] = [];
  for (let i = 0; i < 5; i++) cGen1.push(addStudent(rootC, LINEAGES.c));

  // demo-two-lineages: a teacher in lineage A two rows below the shared ancestor and a
  // teacher in lineage B four rows below it, so the edge from the other lineage decides
  // its rank in a view that shows both branches (plan §4.4).
  const teacherInA = aGen2[1]!;
  const b3 = addStudent(bGen2[1]!, LINEAGES.b);
  const teacherInB = addStudent(b3, LINEAGES.b);
  const twoLineages = addStudent(teacherInA, LINEAGES.a, { slug: 'demo-two-lineages', displayName: 'Demo Two Lineages' });
  addEdge(teacherInB, twoLineages, LINEAGES.b, 'crossLineage');
  twoLineages.depth = teacherInB.depth + 1;
  addStudent(twoLineages, LINEAGES.a);
  const studentInB = addPerson({ lineage: LINEAGES.b, depth: twoLineages.depth + 1, startYear: yearAt(6), historical: false });
  addEdge(twoLineages, studentInB, LINEAGES.b, 'primary', { isDisplayPrimary: true });

  // --- Hubs ------------------------------------------------------------------------------
  for (let i = 0; i < hubStudents; i++) addStudent(hubA, LINEAGES.a);
  for (let i = 0; i < hubStudents - 3; i++) addStudent(hubB, LINEAGES.b);

  // demo-converging: two teachers in lineage A; the second one teaches across two rows,
  // so ELK routes that edge through dummy nodes.
  const hubAStudent = studentsOf.get(hubA.id)![3]!;
  const converging = addStudent(people.find((p) => p.id === hubAStudent.studentId)!, LINEAGES.a, {
    slug: 'demo-converging',
    displayName: 'Demo Converging',
  });
  addEdge(aGen2[2]!, converging, LINEAGES.a, 'converging');
  addStudent(converging, LINEAGES.a);

  // --- Random growth up to the lineage sizes -------------------------------------------
  const hubs = new Set([hubA.id, hubB.id]);
  const members = (lineage: string) => people.filter((p) => p.lineage === lineage);
  const grow = (lineage: string, target: number, maxDepth: number) => {
    while (members(lineage).length < target) {
      const candidates = members(lineage).filter((p) => p.depth < maxDepth && !hubs.has(p.id));
      // Prefer the deeper rows a little, so the lineages reach 6–8 generations.
      const weighted = candidates.flatMap((p) => (p.depth >= 3 ? [p, p] : [p]));
      addStudent(pick(weighted), lineage);
    }
  };
  grow(LINEAGES.a, sizes.a, 8);
  grow(LINEAGES.b, sizes.b, 8);
  grow(LINEAGES.c, sizes.c, 7);

  // --- Second teachers ----------------------------------------------------------------
  const anchorIds = new Set([shared, rootA, rootB, rootC, hubA, hubB, twoLineages, converging].map((p) => p.id));
  const regular = people.filter((p) => !anchorIds.has(p.id) && teachersOf.get(p.id)!.length === 1);
  const shuffled = regular
    .map((p) => ({ p, r: random() }))
    .sort((x, y) => x.r - y.r || (x.p.id < y.p.id ? -1 : 1))
    .map((x) => x.p);
  const total = people.length;
  const convergingCount = Math.round(total * 0.08);
  const crossCount = Math.round(total * 0.03);
  const historicalCount = Math.round(total * 0.02);
  let cursor = 0;
  const tryAddSecondTeacher = (student: Person, sameLineage: boolean): boolean => {
    const pool = people.filter(
      (t) =>
        (sameLineage ? t.lineage === student.lineage : t.lineage !== student.lineage) &&
        t.depth < student.depth &&
        t.depth >= Math.max(0, student.depth - 3) &&
        !teachersOf.get(student.id)!.some((e) => e.teacherId === t.id) &&
        !isAncestorOrSelf(student.id, t.id),
    );
    if (pool.length === 0) return false;
    const teacher = pick(pool);
    addEdge(teacher, student, sameLineage ? student.lineage : teacher.lineage, sameLineage ? 'converging' : 'crossLineage');
    return true;
  };
  let added = 0;
  while (added < convergingCount && cursor < shuffled.length) {
    if (tryAddSecondTeacher(shuffled[cursor++]!, true)) added++;
  }
  added = 0;
  while (added < crossCount && cursor < shuffled.length) {
    if (tryAddSecondTeacher(shuffled[cursor++]!, false)) added++;
  }
  // Historical-only people: every relationship has ended.
  added = 0;
  while (added < historicalCount && cursor < shuffled.length) {
    const person = shuffled[cursor++]!;
    person.historical = true;
    for (const edge of teachersOf.get(person.id)!) {
      const from = Number(edge.periods[0]?.from ?? person.startYear);
      edge.periods = [{ from: String(from), to: String(from + int(3, 12)), ongoing: false, precision: 'year' }];
    }
    added++;
  }
  // A few relationships in every other state of plan §6.7.
  const otherStates: RelationshipStatus[] = ['pending_teacher', 'awaiting_claim', 'under_review', 'in_arbitration'];
  for (const status of otherStates) {
    for (let i = 0; i < 3; i++) {
      const edge = edges[int(20, edges.length - 1)]!;
      if (edge.status === 'verified' && !anchorIds.has(edge.studentId)) {
        edge.status = status;
        if (status !== 'in_arbitration') edge.visibility = 'involved_only';
      }
    }
  }

  // --- Assemble the §6.3 shape -----------------------------------------------------------
  const lineageIdsOf = (person: Person) => {
    const ids = new Set<string>([person.lineage]);
    for (const e of teachersOf.get(person.id)!) ids.add(e.lineageId);
    for (const e of studentsOf.get(person.id)!) ids.add(e.lineageId);
    return [...ids].sort();
  };
  const nodes: LineageNode[] = people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    altNames: [],
    lifeStatus: p.depth <= 1 || p.slug === 'demo-root-c' ? 'deceased' : 'living',
    claimState: p.depth <= 1 ? 'unclaimed' : 'claimed',
    lineageIds: lineageIdsOf(p),
    childCount: studentsOf.get(p.id)!.length,
    hasMoreChildren: false,
  }));
  const graph: LineageGraph = {
    focusId: null,
    dataVersion: `synthetic-${seed}`,
    nodes,
    edges,
    hiddenCounts: {},
  };
  const slugById: Record<string, string> = {};
  const idBySlug: Record<string, string> = {};
  for (const p of people) {
    slugById[p.id] = p.slug;
    idBySlug[p.slug] = p.id;
  }
  return { seed, graph, slugById, idBySlug };
}

/** The id of an anchor record (throws for an unknown slug). */
export function anchorId(dataset: SyntheticDataset, slug: AnchorSlug): string {
  const id = dataset.idBySlug[slug];
  if (!id) throw new Error(`Unknown anchor slug: ${slug}`);
  return id;
}
