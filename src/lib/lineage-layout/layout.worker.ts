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
 * (`self`, `postMessage`, `globalThis.document`); ESLint enforces it.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { LayoutWorkerInbound, LayoutWorkerOutbound } from './types.ts';
import { createLayoutWorkerHandler } from './worker-handler.ts';

declare const self: DedicatedWorkerGlobalScope;

/**
 * Creates the ELK engine of this worker so that it runs in this thread.
 *
 * `elk.bundled.js` evaluates its embedded ELK worker module on the first `new ELK()` and picks
 * its mode then, once per realm. Inside any dedicated worker (`document` undefined, `self`
 * defined) it takes the worker branch: it sets `self.onmessage` to its own dispatcher and
 * exports no in-thread `FakeWorker`, so `new ELK()` throws `TypeError: _Worker is not a
 * constructor` and the page's messages would go to ELK instead of to us. A `document`
 * placeholder during that first construction makes it take the in-thread branch; the
 * placeholder is removed at once, and every later `new ELK()` in this worker (for example
 * `sharedElkEngine()` in layout.ts) reuses the cached in-thread module.
 */
function createInThreadElk(): InstanceType<typeof ELK> {
  const scope = globalThis as { document?: unknown };
  const hadDocument = 'document' in scope;
  if (!hadDocument) scope.document = {};
  try {
    return new ELK();
  } finally {
    if (!hadDocument) delete scope.document;
  }
}

const handle = createLayoutWorkerHandler({
  engine: createInThreadElk(),
  post: (message: LayoutWorkerOutbound) => self.postMessage(message),
});

self.addEventListener('message', (event: MessageEvent<LayoutWorkerInbound>) => handle(event.data));
