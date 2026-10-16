/**
 * layout.worker.ts in a simulated dedicated worker scope (`self` defined, `document` not).
 *
 * This test has a file of its own on purpose. `elk.bundled.js` picks its mode on the first
 * `new ELK()` of a realm and caches it, and `vi.resetModules()` does not reset that cache
 * (elkjs is an externalized CommonJS dependency). Vitest runs every test file in a fresh
 * process, so here no ELK engine exists before layout.worker.ts creates its own, exactly as
 * in a real Web Worker. Sharing a file with tests that call `createElkEngine()` first would
 * let the test pass even when the worker entry point throws in a real browser worker.
 *
 * The same entry point runs in real browsers in e2e/lineage-layout-worker.spec.ts (@M03).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoGraph } from './testing/build.ts';
import type { LayoutWorkerInbound, LayoutWorkerOutbound } from './types.ts';

const small = demoGraph(['r', 'a', 'b'], [['r', 'a'], ['a', 'b']], { focusId: 'b' });
const cyclic = demoGraph(['a', 'b'], [['a', 'b'], ['b', 'a', 'crossLineage']]);

type Listener = (event: { data: LayoutWorkerInbound }) => void;

/** The parts of DedicatedWorkerGlobalScope that layout.worker.ts and elk.bundled.js touch. */
function workerScope() {
  const listeners: Listener[] = [];
  const posted: LayoutWorkerOutbound[] = [];
  const scope = {
    onmessage: undefined as unknown,
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') listeners.push(listener);
    },
    postMessage: (message: LayoutWorkerOutbound) => posted.push(message),
  };
  return { scope, listeners, posted };
}

async function settle(posted: LayoutWorkerOutbound[], count: number) {
  await vi.waitFor(
    () => {
      if (posted.length < count) throw new Error(`waiting for ${count} answers, have ${posted.length}`);
    },
    { timeout: 10_000 },
  );
}

describe('layout.worker.ts in a simulated dedicated worker scope', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('runs ELK in its own thread without taking over self.onmessage, and answers through postMessage', async () => {
    const { scope, listeners, posted } = workerScope();
    vi.stubGlobal('self', scope);
    // A dedicated worker has no document; elk.bundled.js keys its mode on exactly that.
    expect('document' in globalThis).toBe(false);

    await import('./layout.worker.ts');

    // The document placeholder of createInThreadElk is gone again.
    expect('document' in globalThis).toBe(false);
    // ELK did not install its own dispatcher on the channel to the page.
    expect(scope.onmessage).toBeUndefined();
    expect(listeners).toHaveLength(1);

    listeners[0]!({ data: { type: 'layout', requestId: 1, graph: small } });
    listeners[0]!({ data: { type: 'layout', requestId: 2, graph: small } });
    await settle(posted, 2);
    expect(posted.map((m) => [m.type, m.requestId])).toEqual([
      ['stale', 1],
      ['result', 2],
    ]);
    const answer = posted[1]!;
    if (answer.type !== 'result') throw new Error(`expected a result, got ${answer.type}`);
    expect(answer.scene.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'r']);
    // The scene survives structured cloning, as postMessage requires.
    expect(structuredClone(answer)).toEqual(answer);

    listeners[0]!({ data: { type: 'layout', requestId: 3, graph: cyclic } });
    await settle(posted, 3);
    expect(posted[2]).toMatchObject({ type: 'error', requestId: 3, error: { code: 'CYCLE' } });
  });
});
