import { serializeLayoutError } from './errors.ts';
import { layoutLineageWithStats, type ElkEngine } from './layout.ts';
import type { LayoutWorkerInbound, LayoutWorkerOutbound, LayoutWorkerRequest } from './types.ts';

export interface LayoutWorkerHandlerDeps {
  /** The ELK engine of this thread (elk.bundled.js runs the layout in the calling thread). */
  engine: ElkEngine;
  /** Sends a message back to the page. */
  post: (message: LayoutWorkerOutbound) => void;
  /**
   * Schedules the next layout. The default (`setTimeout(…, 0)`) lets every message that is
   * already queued arrive first, so a burst of requests is laid out only once, for the
   * newest request.
   */
  schedule?: (run: () => void) => void;
}

/**
 * The message handler of the layout worker, kept apart from layout.worker.ts so that it can
 * be tested without a browser. Requests carry a monotonically increasing `requestId`:
 *
 * - a request older than (or equal to) the newest one seen is answered with `stale` at once;
 * - a queued request that a newer one overtakes is answered with `stale`;
 * - a request whose layout finishes after a newer request or a `cancel` arrived is answered
 *   with `stale` instead of its scene;
 * - every other request is answered with `result` or, for a cycle or bad input, `error`.
 *
 * Exactly one answer is posted for every request.
 */
export function createLayoutWorkerHandler(deps: LayoutWorkerHandlerDeps): (message: LayoutWorkerInbound) => void {
  const schedule = deps.schedule ?? ((run: () => void) => void setTimeout(run, 0));
  let newest = Number.NEGATIVE_INFINITY;
  let cancelledUpTo = Number.NEGATIVE_INFINITY;
  let pending: LayoutWorkerRequest | null = null;
  let running = false;

  const isStale = (requestId: number) => requestId !== newest || requestId <= cancelledUpTo;

  async function drain(): Promise<void> {
    running = true;
    try {
      while (pending) {
        const request: LayoutWorkerRequest = pending;
        pending = null;
        if (isStale(request.requestId)) {
          deps.post({ type: 'stale', requestId: request.requestId });
          continue;
        }
        try {
          const { scene, stats } = await layoutLineageWithStats(request.graph, request.options ?? {}, deps.engine);
          deps.post(
            isStale(request.requestId)
              ? { type: 'stale', requestId: request.requestId }
              : { type: 'result', requestId: request.requestId, scene, stats },
          );
        } catch (error) {
          deps.post(
            isStale(request.requestId)
              ? { type: 'stale', requestId: request.requestId }
              : { type: 'error', requestId: request.requestId, error: serializeLayoutError(error) },
          );
        }
      }
    } finally {
      running = false;
    }
  }

  return (message: LayoutWorkerInbound) => {
    if (!message || typeof message.requestId !== 'number' || Number.isNaN(message.requestId)) return;
    if (message.type === 'cancel') {
      cancelledUpTo = Math.max(cancelledUpTo, message.requestId);
      if (pending && pending.requestId <= cancelledUpTo) {
        deps.post({ type: 'stale', requestId: pending.requestId });
        pending = null;
      }
      return;
    }
    if (message.type !== 'layout') return;
    if (message.requestId <= newest || message.requestId <= cancelledUpTo) {
      deps.post({ type: 'stale', requestId: message.requestId });
      return;
    }
    newest = message.requestId;
    if (pending) deps.post({ type: 'stale', requestId: pending.requestId });
    pending = message;
    if (!running) {
      running = true;
      schedule(() => void drain());
    }
  };
}
