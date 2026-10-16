/// <reference lib="webworker" />
/**
 * The only Web Worker entry point of the lineage layout (plan §4.1). The page creates it in
 * src/components/lineage/useLayoutWorker.ts (M05) with
 * `new Worker(new URL('../../lib/lineage-layout/layout.worker.ts', import.meta.url), { type: 'module' })`.
 *
 * It imports `elkjs/lib/elk.bundled.js`, runs every layout synchronously in this thread and
 * answers requests that a newer request or a `cancel` overtook with `stale` (by request id).
 * `elk-worker.min.js` is not used: there is no worker inside this worker.
 *
 * This file is the only one in src/lib/lineage-layout that may use worker globals
 * (`self`, `postMessage`); ESLint enforces it.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { LayoutWorkerInbound, LayoutWorkerOutbound } from './types.ts';
import { createLayoutWorkerHandler } from './worker-handler.ts';

declare const self: DedicatedWorkerGlobalScope;

const handle = createLayoutWorkerHandler({
  engine: new ELK(),
  post: (message: LayoutWorkerOutbound) => self.postMessage(message),
});

self.addEventListener('message', (event: MessageEvent<LayoutWorkerInbound>) => handle(event.data));
