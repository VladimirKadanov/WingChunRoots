'use client';

// The interactive explorer (plan §4.1, §4.3–§4.8, §4.10; milestone M05), a client island:
//
// - its state is in the URL (nuqs): focus, up, down, lineage, show, view;
// - the data comes from TanStack Query with the browser's oRPC client (src/lib/rpc-client), the
//   first read from the server so the page needs no second round trip;
// - the layout runs in the Web Worker of src/lib/lineage-layout (useLayoutWorker), which loads ELK
//   only here; until the scene is ready the canvas shows a skeleton of the same shape (plan §5.6);
// - React Flow (./canvas.tsx) loads with next/dynamic, only on this route;
// - "Graph / List": <Activity> keeps the graph's state (zoom, selection) while the list, the M04
//   list view rendered on the server, is shown (plan §4.10).
//
// The keyboard model, aria-live, ancestor highlighting, expand buttons and the phone sheet are
// M06; here a selected node opens a simple panel with "Open profile".

import { QueryClient, QueryClientProvider, skipToken, useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { createParser, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Activity, type ReactNode, useEffect, useState } from 'react';

import { CloseIcon, MinusIcon, PlusIcon } from '@/components/icons';
import { Legend, legendKinds } from '@/components/ink/legend';
import type { LinkKind } from '@/components/ink/link-stroke';
import { buttonVariants } from '@/components/ui/button-variants';
import { useMediaQuery } from '@/components/ui/use-media-query';
import { cx } from '@/lib/cx';
import { computeRanks } from '@/lib/lineage-layout/ranks';
import type { Scene } from '@/lib/lineage-layout/types';
import { orpc } from '@/lib/rpc-client';
import type { ExploreStartDto } from '@/server/dto/explore';
import type { LineageGraphDto } from '@/server/dto/public';
import { chainEdge, generationLabels, generationText } from '../generation';
import { GenerationText } from '../generation-text';
import { isHistoricalRelation, periodText, relationStatus, strokeOf } from '../status';
import { useLayoutWorker } from '../useLayoutWorker';
import type { LineageEdge, PersonNode } from './canvas';
import {
  explorerRead,
  type ExplorerParams,
  GENERATIONS_DEFAULT,
  isUuid,
  MAX_DOWN,
  MAX_UP,
  NARROW_QUERY,
  capFanout,
  drawnByDefault,
  parseCount,
  readKey,
  toLayoutGraph,
  viewKind,
  type ViewKind,
} from './state';

const ExplorerCanvas = dynamic(() => import('./canvas'), { ssr: false, loading: () => null });

const parseAsId = createParser({
  parse: (value: string) => (isUuid(value) ? value.toLowerCase() : null),
  serialize: (value: string) => value,
});
// The same rule as the server's paramsFrom, so both sides make the same first read.
const parseAsCount = createParser({
  parse: (value: string) => parseCount(value),
  serialize: (value: number) => String(value),
});
const parsers = {
  focus: parseAsId,
  up: parseAsCount,
  down: parseAsCount,
  lineage: parseAsId,
  show: parseAsStringLiteral(['historical'] as const),
  view: parseAsStringLiteral(['graph', 'list'] as const).withDefault('graph'),
};

export interface ExplorerProps {
  /** The server's first read and the key of the request it answers. */
  initial: { key: string; graph: LineageGraphDto } | null;
  /** Lineages with their public roots (the lineage view's root). */
  starts: ExploreStartDto['lineages'];
  /** The list view (M04), rendered on the server when view=list. */
  list: ReactNode;
}

/** A person who is not on the record, or a malformed request: retrying cannot change the answer. */
const isFinal = (error: unknown) => /NOT_FOUND|BAD_REQUEST/.test(String((error as { code?: string } | null)?.code ?? ''));

export function Explorer(props: ExplorerProps) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: (failures, error) => failures < 1 && !isFinal(error) } },
      }),
  );
  return (
    <NuqsAdapter>
      <QueryClientProvider client={client}>
        <ExplorerBody {...props} />
      </QueryClientProvider>
    </NuqsAdapter>
  );
}

const VIEW_LABELS: Record<ViewKind, string> = { person: 'Person', generations: 'Generations', lineage: 'Lineage' };

function buildFlow(graph: LineageGraphDto, scene: Scene, more: Map<string, number>, showHistorical: boolean, selectedId: string | null) {
  const persons = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const lineages = new Map(graph.lineages.map((l) => [l.id, l]));
  const roots = new Set(graph.lineages.map((l) => l.rootPersonId).filter(Boolean));
  // Ended training is drawn only with show=historical or for the selected person (plan §4.6, §4.7).
  const hidden = (e: (typeof graph.edges)[number]) =>
    isHistoricalRelation(e.periods) && !showHistorical && !(selectedId !== null && (e.teacherId === selectedId || e.studentId === selectedId));
  const drawn = graph.edges.filter((e) => !hidden(e));
  // A label speaks of the lines drawn: it never counts from, or names, someone who is not shown.
  const labels = generationLabels({ ...graph, edges: drawn });
  // The chip and the status speak of the lines drawn, not of hidden ones.
  const incoming = new Map<string, typeof drawn>();
  for (const e of drawn) incoming.set(e.studentId, [...(incoming.get(e.studentId) ?? []), e]);
  // A person whose every line is hidden would stand alone on the canvas, unexplained.
  const linked = new Set(graph.edges.map((e) => [e.teacherId, e.studentId]).flat());
  const shown = new Set(drawn.map((e) => [e.teacherId, e.studentId]).flat());

  const nodes: PersonNode[] = scene.nodes.map((sn) => {
    const person = persons.get(sn.id)!;
    const original = person.altNames.find((a) => a.kind === 'name' && a.script !== 'Latn') ?? null;
    const label = labels.get(sn.id);
    const statusEdge = chainEdge(incoming.get(sn.id) ?? []);
    return {
      id: sn.id,
      type: 'person',
      position: { x: sn.x, y: sn.y },
      width: sn.width,
      height: sn.height,
      draggable: false,
      hidden: linked.has(sn.id) && !shown.has(sn.id) && sn.id !== graph.focusId && sn.id !== selectedId,
      selected: sn.id === selectedId,
      ariaLabel: `${person.displayName}${label ? `, ${generationText(label)}` : ''}`,
      data: {
        name: person.displayName,
        original: original ? { value: original.value, lang: original.lang } : null,
        generation: label ?? null,
        status: statusEdge ? relationStatus(statusEdge.status) : null,
        disputed: (incoming.get(sn.id) ?? []).some((e) => e !== statusEdge && e.status === 'in_arbitration'),
        teachers: incoming.get(sn.id)?.length ?? 0,
        more: more.get(sn.id) ?? 0,
        rank: sn.rank,
        focus: sn.id === graph.focusId,
        root: roots.has(sn.id),
        slot: { x: sn.x, y: sn.y, width: sn.width, height: sn.height },
        boxes: sn.boxes,
      },
    };
  });

  const boxes = new Map(scene.nodes.map((sn) => [sn.id, sn.boxes]));
  const flowEdges: LineageEdge[] = scene.edges.map((se) => {
    const edge = edges.get(se.id)!;
    const historical = isHistoricalRelation(edge.periods);
    const stroke = strokeOf(edge);
    const lineageName = lineages.get(edge.lineageId)?.name ?? 'another lineage';
    const label = se.kind === 'crossLineage' ? `Teacher in ${lineageName}` : historical ? periodText(edge.periods) : null;
    return {
      id: se.id,
      type: 'lineage',
      source: se.teacherId,
      target: se.studentId,
      hidden: hidden(edge),
      selectable: false,
      focusable: false,
      ariaLabel: `${persons.get(edge.teacherId)?.displayName ?? ''} taught ${persons.get(edge.studentId)?.displayName ?? ''}: ${relationStatus(edge.status).label}${se.kind === 'crossLineage' ? `, teacher in ${lineageName}` : ''}${historical ? `, ${periodText(edge.periods)}` : ''}`,
      data: { stroke, kind: se.kind, lineageId: edge.lineageId, routedBy: se.routedBy, path: se.path, label, historical, ends: { teacher: boxes.get(se.teacherId)!, student: boxes.get(se.studentId)! } },
    };
  });
  return { nodes, edges: flowEdges };
}

/** The strokes the canvas draws, for the legend (a legend lists only what is drawn). */
function drawnKinds(graph: LineageGraphDto, edges: readonly LineageEdge[]): LinkKind[] {
  const visible = new Set(edges.filter((e) => !e.hidden).map((e) => e.id));
  const kinds = new Set<LinkKind>();
  for (const e of graph.edges) {
    if (!visible.has(e.id)) continue;
    kinds.add(relationStatus(e.status).kind);
    if (e.kind === 'crossLineage') kinds.add('cross_lineage');
    if (isHistoricalRelation(e.periods)) kinds.add('historical');
  }
  return legendKinds(kinds);
}

/** A skeleton with the shape of the coming drawing: one row per generation, a slot per person (plan §5.6). */
function Skeleton({ graph, showHistorical }: { graph: LineageGraphDto | null; showHistorical: boolean }) {
  let rows: number[] = [1, 2, 4];
  if (graph && graph.nodes.length > 0) {
    try {
      const { ranks, rankCount } = computeRanks(toLayoutGraph(drawnByDefault(capFanout(graph).graph, showHistorical)));
      rows = Array.from({ length: rankCount }, () => 0);
      for (const rank of ranks.values()) rows[rank] = (rows[rank] ?? 0) + 1;
    } catch {
      // A graph the layout refuses (a cycle) gets the generic shape; the error state follows.
    }
  }
  return (
    <div data-testid="explorer-skeleton" aria-busy="true" className="absolute inset-0 flex flex-col items-center justify-center gap-[30px] overflow-hidden p-6">
      <span className="sr-only" role="status">
        Laying out the lineage…
      </span>
      {rows.slice(0, 8).map((count, i) => (
        <div key={i} data-skeleton-row={i} className="flex max-w-full justify-center gap-3 overflow-hidden">
          {Array.from({ length: Math.min(count, 7) }, (_, j) => (
            <div key={j} className="h-16 w-[200px] max-w-[42vw] shrink-0 animate-pulse rounded-sm border border-border-subtle bg-surface-2 motion-reduce:animate-none" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const button =
    'inline-grid size-11 place-items-center text-fg hover:bg-surface-3 active:bg-surface-pressed disabled:text-fg-subtle disabled:hover:bg-transparent';
  return (
    <div role="group" aria-label={label} className="inline-flex items-center rounded-sm border border-border-strong">
      <button type="button" className={button} aria-label={`Fewer generations of ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <MinusIcon size={16} />
      </button>
      <span className="px-0.5 text-center text-sm whitespace-nowrap tabular-nums md:min-w-[6.5rem] md:px-1" aria-live="off">
        {label}: <span className="font-semibold">{value}</span>
      </span>
      <button type="button" className={button} aria-label={`More generations of ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-sm border border-border-strong p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xs px-3 text-sm font-semibold text-fg-muted hover:bg-surface-3 hover:text-fg aria-pressed:bg-fg aria-pressed:text-fg-inverse"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ExplorerBody({ initial, starts, list }: ExplorerProps) {
  const [url, setUrl] = useQueryStates(parsers);
  const narrow = useMediaQuery(NARROW_QUERY);
  const params: ExplorerParams = { focus: url.focus, up: url.up, down: url.down, lineage: url.lineage, show: url.show, view: url.view };
  const focus = params.focus;
  const lineageRoot = starts.find((l) => l.id === params.lineage)?.root.id ?? null;
  const read = focus ? explorerRead({ ...params, focus }, lineageRoot, narrow) : null;
  const key = read ? readKey(read) : 'none';
  // The oRPC query options: a key per procedure and input, and a request TanStack Query can abort.
  const reuse = {
    initialData: initial && initial.key === key ? initial.graph : undefined,
    placeholderData: (previous: LineageGraphDto | undefined) => previous,
  };
  const query = useQuery(
    read?.procedure === 'subtree'
      ? orpc.lineage.subtree.queryOptions({ input: read.input, ...reuse })
      : orpc.lineage.ego.queryOptions({ input: read ? read.input : skipToken, ...reuse }),
  );
  const graph = query.data ?? null;

  const layout = useLayoutWorker();
  // `source` is the answer of the read; `graph` what is drawn of it (plan §4.8: large fan-outs counted).
  const [laidOut, setLaidOut] = useState<{ source: LineageGraphDto; graph: LineageGraphDto; more: Map<string, number>; scene: Scene } | null>(null);
  // The answer whose layout failed: the error belongs to that answer only, not to the next one.
  const [failed, setFailed] = useState<LineageGraphDto | null>(null);
  useEffect(() => {
    if (!graph) return;
    let current = true;
    const capped = capFanout(graph);
    layout(toLayoutGraph(capped.graph), { focusId: graph.focusId })
      .then((answer) => {
        if (current && answer) setLaidOut({ source: graph, graph: capped.graph, more: capped.more, scene: answer.scene });
      })
      .catch(() => {
        if (current) setFailed(graph);
      });
    return () => {
      current = false;
    };
  }, [graph, layout]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ready = laidOut !== null && laidOut.source === graph;
  const layoutError = graph !== null && failed === graph;
  // While the next scene is laid out the last one stays on the canvas, so the people who stay move
  // to their new places (plan §5.2) instead of the canvas starting over; the skeleton is for the first.
  const flow = laidOut ? buildFlow(laidOut.graph, laidOut.scene, laidOut.more, params.show === 'historical', selectedId) : null;
  const selected = laidOut && selectedId ? laidOut.graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedMore = selected ? laidOut?.more.get(selected.id) ?? 0 : 0;
  const selectedGeneration = selected ? flow?.nodes.find((n) => n.id === selected.id)?.data.generation ?? null : null;
  const focusNode = graph?.nodes.find((n) => n.id === focus) ?? null;
  const kind = viewKind(params);
  const focusLineages = (focusNode?.lineageIds ?? []).map((id) => graph?.lineages.find((l) => l.id === id)).filter((l) => l !== undefined);

  // Only the list needs the server (it renders the M04 list view); the graph is all in the browser.
  const setView = (next: 'graph' | 'list') => void setUrl({ view: next === 'graph' ? null : next }, { shallow: next === 'graph', scroll: false });
  const setKind = (next: ViewKind) => {
    if (next === 'person') void setUrl({ up: null, down: null, lineage: null });
    else if (next === 'generations') void setUrl({ up: GENERATIONS_DEFAULT, down: GENERATIONS_DEFAULT, lineage: null });
    else void setUrl({ lineage: focusLineages[0]?.id ?? starts[0]?.id ?? null, up: null, down: null });
  };
  const currentUp = read?.procedure === 'ego' ? read.input.up : 0;
  const currentDown = read?.procedure === 'ego' ? read.input.down : read?.input.depth ?? 0;

  const notFound = query.isError && isFinal(query.error);
  // The lineage view reads the lineage from its root, whoever is in focus: centring there opens the person view.
  const centerOn = (id: string) => void setUrl(kind === 'lineage' ? { focus: id, lineage: null } : { focus: id });
  const lineageName = starts.find((l) => l.id === params.lineage)?.name ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Always visible: what is in focus, and Graph / List. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle px-[max(1rem,env(safe-area-inset-left,0px))] py-2 md:px-6">
        <div className="min-w-0">
          <p className="eyebrow">Explorer · {VIEW_LABELS[kind]}</p>
          {params.view === 'graph' ? (
            <h1 className="truncate font-display text-xl leading-tight md:text-2xl">
              {focusNode ? (
                <span lang="und-Latn" translate="no">
                  {focusNode.displayName}
                </span>
              ) : kind === 'lineage' && lineageName ? (
                lineageName
              ) : (
                'Lineage graph'
              )}
            </h1>
          ) : null}
        </div>
        <Segmented
          label="Show as"
          value={params.view}
          options={[
            { value: 'graph', label: 'Graph' },
            { value: 'list', label: 'List' },
          ]}
          onChange={setView}
        />
      </div>

      <Activity mode={params.view === 'graph' ? 'visible' : 'hidden'}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-[max(1rem,env(safe-area-inset-left,0px))] py-2 pr-[max(1rem,env(safe-area-inset-right,0px))] md:px-6">
            <Segmented
              label="View"
              value={kind}
              options={[
                { value: 'person', label: 'Person' },
                { value: 'generations', label: 'Generations' },
                { value: 'lineage', label: 'Lineage' },
              ]}
              onChange={setKind}
            />
            {kind === 'generations' ? (
              <>
                <Stepper label="Teachers" value={currentUp} min={0} max={MAX_UP} onChange={(up) => void setUrl({ up })} />
                <Stepper label="Students" value={currentDown} min={0} max={MAX_DOWN} onChange={(down) => void setUrl({ down })} />
              </>
            ) : null}
            {kind === 'lineage' && focusLineages.length > 1 ? (
              <Segmented
                label="Lineage"
                value={params.lineage ?? ''}
                options={focusLineages.map((l) => ({ value: l.id, label: l.name }))}
                onChange={(lineage) => void setUrl({ lineage })}
              />
            ) : null}
            <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 px-1 text-sm">
              <input
                type="checkbox"
                defaultChecked={params.show === 'historical'}
                key={params.show ?? 'none'}
                onChange={(e) => void setUrl({ show: e.currentTarget.checked ? 'historical' : null })}
                className="size-5 cursor-pointer accent-[var(--fg)]"
              />
              Show ended training
            </label>
          </div>

          <div className="relative min-h-0 flex-1 [touch-action:none]">
            {!focus ? null : notFound ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <p className="max-w-[40ch] text-ui text-fg-muted">There is no public profile with this address in the record.</p>
              </div>
            ) : query.isError && !graph ? (
              <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
                <div className="grid justify-items-center gap-3">
                  <p className="max-w-[40ch] text-ui">The lineage could not be loaded. Nothing was changed.</p>
                  <button type="button" className={buttonVariants({ variant: 'secondary' })} onClick={() => void query.refetch()}>
                    Retry
                  </button>
                </div>
              </div>
            ) : layoutError ? (
              <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
                <p className="max-w-[44ch] text-ui">
                  This lineage could not be drawn.{' '}
                  {focusNode ? (
                    <Link href={`/people/${focusNode.slug}/lineage`} className="link">
                      Open the list view
                    </Link>
                  ) : null}
                </p>
              </div>
            ) : !flow || !laidOut ? (
              <Skeleton graph={graph} showHistorical={params.show === 'historical'} />
            ) : (
              <ExplorerCanvas scene={laidOut.scene} nodes={flow.nodes} edges={flow.edges} onSelect={setSelectedId}>
                {ready ? null : (
                  <p
                    role="status"
                    data-testid="explorer-relayout"
                    className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-sm border border-border-subtle bg-surface-1 px-3 py-1.5 text-sm text-fg-muted"
                  >
                    Laying out the lineage…
                  </p>
                )}
                <div
                  data-testid="explorer-legend"
                  className="pointer-events-auto absolute bottom-3 left-[max(0.75rem,env(safe-area-inset-left,0px))] max-w-[calc(100%-5.5rem)] rounded-sm border border-border-subtle bg-surface-1 px-3 py-2 [--seal-ground:var(--surface-1)]"
                >
                  <Legend kinds={drawnKinds(laidOut.graph, flow.edges)} layout="wrap" />
                </div>
                {selected ? (
                  <section
                    aria-label={`Selected: ${selected.displayName}`}
                    data-testid="explorer-panel"
                    // A sheet along the bottom on a phone, clear of the people above it; on the right from md (plan §4.7).
                    className="pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] bottom-3 left-[max(0.75rem,env(safe-area-inset-left,0px))] grid gap-3 rounded-sm border border-border-strong bg-surface-1 p-4 shadow-pop [--seal-ground:var(--surface-1)] md:top-3 md:bottom-auto md:left-auto md:w-[min(20rem,calc(100%-1.5rem))]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-display text-xl leading-tight [overflow-wrap:anywhere]">
                        <span lang="und-Latn" translate="no">
                          {selected.displayName}
                        </span>
                      </h2>
                      <button
                        type="button"
                        aria-label="Close"
                        onClick={() => setSelectedId(null)}
                        className="-mt-2 -mr-2 inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
                      >
                        <CloseIcon size={18} />
                      </button>
                    </div>
                    {selectedGeneration ? (
                      <p className="text-sm text-fg-muted">
                        <GenerationText label={selectedGeneration} />
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/people/${selected.slug}`} className={buttonVariants({ variant: 'primary' })}>
                        Open profile
                      </Link>
                      {selected.id !== focus ? (
                        <button type="button" className={buttonVariants({ variant: 'secondary' })} onClick={() => centerOn(selected.id)}>
                          Center on this person
                        </button>
                      ) : null}
                    </div>
                    {selectedMore > 0 ? (
                      // Plan §4.8: the students a large fan-out does not draw are a paginated list away.
                      <Link href={`/people/${selected.slug}/lineage#students-heading`} className="link text-sm">
                        All students in the list view (+{selectedMore} not drawn)
                      </Link>
                    ) : null}
                  </section>
                ) : null}
              </ExplorerCanvas>
            )}
          </div>
        </div>
      </Activity>

      <Activity mode={params.view === 'list' ? 'visible' : 'hidden'}>
        <div className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain')}>
          {list ?? (
            <p role="status" className="p-6 text-ui text-fg-muted">
              Loading the list…
            </p>
          )}
        </div>
      </Activity>
    </div>
  );
}
