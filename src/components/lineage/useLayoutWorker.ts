'use client';

// The explorer's layout worker (plan §4.1; milestone M05): the one place that creates the Web
// Worker of src/lib/lineage-layout, so ELK (about 467 KB gzip) loads only with the explorer, in its
// own thread, never in a page bundle or the request path. The worker is created when the explorer
// mounts and warmed at once with a tiny layout, so the first real layout does not also pay for
// reading ELK (plan §4.11). Every request carries a growing id: the worker answers a request a
// newer one overtook with `stale`, which resolves here as null (plan §4.8).

import { useEffect, useRef, useState } from 'react';

import type {
  LayoutOptions,
  LayoutStats,
  LayoutWorkerInbound,
  LayoutWorkerOutbound,
  LineageGraph,
  Scene,
  SerializedLayoutError,
} from '@/lib/lineage-layout/types';

export class LayoutFailure extends Error {
  constructor(readonly detail: SerializedLayoutError) {
    super(detail.message);
    this.name = 'LayoutFailure';
  }
}

export type LayoutAnswer = { scene: Scene; stats: LayoutStats } | null;

interface Pending {
  resolve: (answer: LayoutAnswer) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  worker: Worker;
  nextId: number;
  pending: Map<number, Pending>;
  /** The worker failed to load or threw: it answers nothing more. */
  broken: boolean;
}

const BROKEN = 'The layout worker failed to start.';

const WARMUP_ID = '00000000-0000-4000-8000-0000000000';
/** Two people and one verified relationship: enough to load ELK and run it once. */
const WARMUP_GRAPH: LineageGraph = {
  focusId: `${WARMUP_ID}01`,
  dataVersion: 'warmup',
  nodes: [`${WARMUP_ID}01`, `${WARMUP_ID}02`].map((id) => ({
    id,
    displayName: 'Warm-up',
    altNames: [],
    lifeStatus: 'living',
    claimState: 'unclaimed',
    lineageIds: [`${WARMUP_ID}99`],
    childCount: 0,
    hasMoreChildren: false,
  })),
  edges: [
    {
      id: `${WARMUP_ID}50`,
      teacherId: `${WARMUP_ID}02`,
      studentId: `${WARMUP_ID}01`,
      lineageId: `${WARMUP_ID}99`,
      kind: 'primary',
      status: 'verified',
      isDisplayPrimary: true,
      visibility: 'public',
      periods: [],
    },
  ],
  hiddenCounts: {},
};

/** A function that lays out a graph in the worker; stable for the life of the explorer. */
export type LayoutFn = (graph: LineageGraph, options?: LayoutOptions) => Promise<LayoutAnswer>;

export function useLayoutWorker(): LayoutFn {
  const state = useRef<WorkerState | null>(null);
  const queued = useRef<{ graph: LineageGraph; options?: LayoutOptions; pending: Pending }[]>([]);

  useEffect(() => {
    const worker = new Worker(new URL('../../lib/lineage-layout/layout.worker.ts', import.meta.url), { type: 'module' });
    const current: WorkerState = { worker, nextId: 1, pending: new Map(), broken: false };
    worker.addEventListener('message', (event: MessageEvent<LayoutWorkerOutbound>) => {
      const message = event.data;
      const waiting = current.pending.get(message.requestId);
      if (!waiting) return;
      current.pending.delete(message.requestId);
      if (message.type === 'result') waiting.resolve({ scene: message.scene, stats: message.stats });
      else if (message.type === 'stale') waiting.resolve(null);
      else waiting.reject(new LayoutFailure(message.error));
    });
    worker.addEventListener('error', () => {
      current.broken = true;
      worker.terminate();
      for (const waiting of current.pending.values()) waiting.reject(new Error(BROKEN));
      current.pending.clear();
    });
    // Warm-up: ELK is read and run once before the first real layout (plan §4.11). Its answer is
    // dropped; a real request sent meanwhile simply overtakes it.
    const warmupId = current.nextId++;
    current.pending.set(warmupId, { resolve: () => undefined, reject: () => undefined });
    worker.postMessage({ type: 'layout', requestId: warmupId, graph: WARMUP_GRAPH } satisfies LayoutWorkerInbound);
    state.current = current;
    // Requests made before the worker existed (the first render) go out now.
    for (const request of queued.current.splice(0)) {
      const requestId = current.nextId++;
      current.pending.set(requestId, request.pending);
      worker.postMessage({ type: 'layout', requestId, graph: request.graph, options: request.options } satisfies LayoutWorkerInbound);
    }
    return () => {
      worker.terminate();
      for (const waiting of current.pending.values()) waiting.resolve(null);
      current.pending.clear();
      if (state.current === current) state.current = null;
    };
  }, []);

  // One function for the life of the explorer (it reads the worker from the ref when called).
  const [layout] = useState<LayoutFn>(
    () => (graph: LineageGraph, options?: LayoutOptions) =>
      new Promise<LayoutAnswer>((resolve, reject) => {
        const current = state.current;
        if (!current) {
          queued.current.push({ graph, options, pending: { resolve, reject } });
          return;
        }
        if (current.broken) {
          reject(new Error(BROKEN));
          return;
        }
        const requestId = current.nextId++;
        current.pending.set(requestId, { resolve, reject });
        current.worker.postMessage({ type: 'layout', requestId, graph, options } satisfies LayoutWorkerInbound);
      }),
  );
  return layout;
}
