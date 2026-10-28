// The state of the explorer's expansions and the reader of a teacher's students (plan §4.8;
// milestone M06, package C), shared by the explorer's first JavaScript (expand.ts) and the chunks
// loaded later (expand-engine.ts, the panel's students-list.tsx).
//
// No runtime imports, on purpose: a module that a lazy chunk imports cannot be merged into the
// explorer's own module (Turbopack's scope hoisting), and neither can anything it imports. Had the
// engine or the list imported TanStack Query, the oRPC client or expand.ts, those would have left
// the explorer's module and its first JavaScript would have grown by more than they weigh.

import type { LayoutOptions, Scene } from '@/lib/lineage-layout/types';
import type { LineageGraphDto, StudentsPageDto } from '@/server/dto/public';

import type { ExpandDirection, Notice } from './graph-api';

export const NOBODY: ReadonlySet<string> = new Set();
export const EXPLORER_LAYOUT: LayoutOptions = { preset: 'explorer' };

/** An expansion merged into the view, for the words said once it is drawn. */
export interface Done {
  id: string;
  direction: ExpandDirection;
  name: string;
}

export interface State {
  /** The read the expansions belong to. */
  key: string;
  /** The dataVersion of the answer the expansions were merged into: a new answer drops them. */
  version: string | null;
  /** The view, or null: the answer as it is. */
  graph: LineageGraphDto | null;
  pinned: ReadonlySet<string>;
  layoutOptions: LayoutOptions;
  anchorId: string | null;
  /** Expansions being read. */
  loading: ReadonlySet<string>;
  /** Expansions merged and being laid out: the scene on screen when they were (the next scene is theirs). */
  laying: { scene: Scene | null; done: readonly Done[] } | null;
  /** `loading` and the people of `laying` as one set, which keeps its identity while they stay the same. */
  pending: ReadonlySet<string>;
  notice: Notice | null;
}

export const fresh = (key: string, notice: Notice | null = null): State => ({
  key,
  version: null,
  graph: null,
  pinned: NOBODY,
  layoutOptions: EXPLORER_LAYOUT,
  anchorId: null,
  loading: NOBODY,
  laying: null,
  pending: NOBODY,
  notice,
});

/** The state with its busy people counted again. */
export function counting(s: State): State {
  const pending = new Set([...s.loading, ...(s.laying?.done.map((d) => d.id) ?? [])]);
  const same = pending.size === s.pending.size && [...pending].every((id) => s.pending.has(id));
  return same ? s : { ...s, pending: pending.size === 0 ? NOBODY : pending };
}

/** A notice with a new key, so the same words are said again. */
export const notice = (s: State, text: string): Notice => ({ key: (s.notice?.key ?? 0) + 1, text });

/** A page of a teacher's students, as people.students answers it. */
export type StudentsInput = { slug: string; page: number; pageSize: number };
type StudentsReader = (input: StudentsInput) => Promise<StudentsPageDto>;

let studentsReader: StudentsReader | null = null;

/**
 * Gives the panel's list its reader (expand.ts useExpansions: people.students through the
 * explorer's query client, so a page read once comes from its cache). Returns the undoing.
 */
export function provideStudents(reader: StudentsReader): () => void {
  studentsReader = reader;
  return () => {
    if (studentsReader === reader) studentsReader = null;
  };
}

/** A page of a teacher's students (students-list.tsx). Fails while no explorer gives a reader. */
export function readStudents(input: StudentsInput): Promise<StudentsPageDto> {
  return studentsReader ? studentsReader(input) : Promise.reject(new Error('No students reader'));
}
