import type { LayoutErrorCode, SerializedLayoutError } from './types.ts';

/** Base class of every error the layout module throws on purpose. */
export class LineageLayoutError extends Error {
  readonly code: LayoutErrorCode;

  constructor(code: LayoutErrorCode, message: string) {
    super(message);
    this.name = 'LineageLayoutError';
    this.code = code;
  }

  toJSON(): SerializedLayoutError {
    return { code: this.code, message: this.message };
  }
}

/**
 * The input contains a cycle. Cycles are refused on write under a global lock (plan §6.3);
 * the module still detects them and fails with this typed error instead of letting ELK
 * reverse an edge at random (plan §4.4).
 */
export class LineageCycleError extends LineageLayoutError {
  /** Node ids of one cycle in edge order; the first id is repeated at the end. */
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super('CYCLE', `The lineage graph contains a cycle: ${cycle.join(' -> ')}`);
    this.name = 'LineageCycleError';
    this.cycle = cycle;
  }

  override toJSON(): SerializedLayoutError {
    return { code: this.code, message: this.message, cycle: [...this.cycle] };
  }
}

/** The input does not have the shape of plan §6.3 (duplicate ids, unknown endpoints, …). */
export class LineageInputError extends LineageLayoutError {
  constructor(message: string) {
    super('INVALID_INPUT', message);
    this.name = 'LineageInputError';
  }
}

/** ELK itself failed; the original error message is kept. */
export class ElkLayoutError extends LineageLayoutError {
  constructor(message: string) {
    super('ELK_FAILED', `ELK layout failed: ${message}`);
    this.name = 'ElkLayoutError';
  }
}

/** Serializes any thrown value for the worker protocol. */
export function serializeLayoutError(error: unknown): SerializedLayoutError {
  if (error instanceof LineageLayoutError) {
    return error.toJSON();
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'ELK_FAILED', message };
}
