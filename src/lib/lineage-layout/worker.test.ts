/**
 * The message protocol of the layout worker (worker-handler.ts), tested in Node with a
 * hand-driven scheduler. The entry point layout.worker.ts itself is tested in its own file,
 * layout.worker.test.ts, because ELK caches its mode per process (see there).
 */
import { describe, expect, it, vi } from 'vitest';
import { createElkEngine } from './layout.ts';
import { demoGraph } from './testing/build.ts';
import type { LayoutWorkerOutbound } from './types.ts';
import { createLayoutWorkerHandler } from './worker-handler.ts';

const small = demoGraph(['r', 'a', 'b'], [['r', 'a'], ['a', 'b']], { focusId: 'b' });
const cyclic = demoGraph(['a', 'b'], [['a', 'b'], ['b', 'a', 'crossLineage']]);

/** A handler whose scheduled runs are released by hand, like queued worker messages. */
function harness() {
  const posted: LayoutWorkerOutbound[] = [];
  const queue: (() => void)[] = [];
  const handle = createLayoutWorkerHandler({
    engine: createElkEngine(),
    post: (m) => posted.push(m),
    schedule: (run) => queue.push(run),
  });
  const flush = async () => {
    while (queue.length > 0) queue.shift()!();
    await vi.waitFor(() => {
      if (posted.length === 0) throw new Error('nothing posted yet');
    });
  };
  return { posted, handle, flush, queue };
}

async function settle(posted: LayoutWorkerOutbound[], count: number) {
  await vi.waitFor(
    () => {
      if (posted.length < count) throw new Error(`waiting for ${count} answers, have ${posted.length}`);
    },
    { timeout: 10_000 },
  );
}

describe('layout worker handler', () => {
  it('answers a request with the scene and stats', async () => {
    const { posted, handle, flush } = harness();
    handle({ type: 'layout', requestId: 1, graph: small });
    await flush();
    await settle(posted, 1);
    expect(posted).toHaveLength(1);
    const answer = posted[0]!;
    expect(answer.type).toBe('result');
    if (answer.type !== 'result') return;
    expect(answer.requestId).toBe(1);
    expect(answer.scene.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'r']);
    expect(answer.stats.nodes).toBe(3);
  });

  it('lays out only the newest of queued requests and answers the older ones with stale', async () => {
    const { posted, handle, flush } = harness();
    handle({ type: 'layout', requestId: 1, graph: small });
    handle({ type: 'layout', requestId: 2, graph: small });
    handle({ type: 'layout', requestId: 3, graph: small });
    await flush();
    await settle(posted, 3);
    expect(posted.map((m) => [m.type, m.requestId])).toEqual([
      ['stale', 1],
      ['stale', 2],
      ['result', 3],
    ]);
  });

  it('answers a request that arrives out of order (older id) with stale at once', async () => {
    const { posted, handle, flush } = harness();
    handle({ type: 'layout', requestId: 5, graph: small });
    handle({ type: 'layout', requestId: 4, graph: small });
    expect(posted).toEqual([{ type: 'stale', requestId: 4 }]);
    await flush();
    await settle(posted, 2);
    expect(posted[1]).toMatchObject({ type: 'result', requestId: 5 });
  });

  it('drops the result of a layout that a newer request overtook while it ran', async () => {
    const { posted, handle, queue } = harness();
    handle({ type: 'layout', requestId: 1, graph: small });
    queue.shift()!(); // request 1 starts
    handle({ type: 'layout', requestId: 2, graph: small }); // arrives while 1 runs
    await settle(posted, 2);
    expect(posted.map((m) => [m.type, m.requestId])).toEqual([
      ['stale', 1],
      ['result', 2],
    ]);
  });

  it('honours cancel for queued and running requests', async () => {
    const { posted, handle, queue } = harness();
    handle({ type: 'layout', requestId: 1, graph: small });
    handle({ type: 'cancel', requestId: 1 });
    expect(posted).toEqual([{ type: 'stale', requestId: 1 }]);
    queue.shift()!();
    handle({ type: 'layout', requestId: 2, graph: small });
    queue.shift()!(); // request 2 starts
    handle({ type: 'cancel', requestId: 2 });
    await settle(posted, 2);
    expect(posted[1]).toEqual({ type: 'stale', requestId: 2 });
    // A cancelled id cannot be reused.
    handle({ type: 'layout', requestId: 2, graph: small });
    expect(posted[2]).toEqual({ type: 'stale', requestId: 2 });
  });

  it('answers a layout request without a numeric id with an error instead of silence', () => {
    const { posted, handle } = harness();
    handle({ type: 'layout', requestId: Number.NaN, graph: small });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', error: { code: 'INVALID_INPUT' } });
  });

  it('answers a cyclic input with a typed error', async () => {
    const { posted, handle, flush } = harness();
    handle({ type: 'layout', requestId: 7, graph: cyclic });
    await flush();
    await settle(posted, 1);
    expect(posted[0]).toMatchObject({ type: 'error', requestId: 7, error: { code: 'CYCLE' } });
    const answer = posted[0]!;
    if (answer.type === 'error') expect(new Set(answer.error.cycle)).toEqual(new Set(['a', 'b']));
  });
});
