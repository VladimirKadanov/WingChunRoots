/**
 * Separation constraints in one dimension (plan §4.6): positions as close as possible to the
 * desired ones, in the weighted least-squares sense, such that `x[right] − x[left] ≥ gap` for
 * every constraint. The layout uses it to place a student with two teachers in one lineage
 * between them after ELK has placed everyone (converging.ts).
 *
 * The solver is the "satisfy" step of VPSC (Dwyer, Marriott and Stuckey, "Fast node overlap
 * removal", Graph Drawing 2005): variables are visited in topological order of the
 * constraints, and a block of variables that a violated constraint joins moves as one, to the
 * weighted mean of its members' desired positions. A final pass in topological order pushes
 * whatever is still violated (it never is in practice), so the result always satisfies every
 * constraint. The constraints must not form a cycle: add them through `ConstraintGraph`.
 *
 * Pure TypeScript and deterministic: the same input gives the same output.
 */

export interface SeparationVariable {
  desired: number;
  /** Positive weight of the variable in the least-squares objective. */
  weight: number;
}

/** `x[right] − x[left] ≥ gap`. */
export interface SeparationConstraint {
  left: number;
  right: number;
  gap: number;
}

/** Below this a constraint counts as satisfied (positions are rounded to 1/100 px later). */
const EPSILON = 1e-6;

/**
 * Constraints collected so that they never form a cycle: `add` refuses a constraint that would
 * close one, so the system always has a solution.
 */
export class ConstraintGraph {
  readonly constraints: SeparationConstraint[] = [];
  readonly size: number;
  private readonly out: number[][];

  // No parameter property: the module also runs under Node's type stripping (pnpm bench:layout).
  constructor(size: number) {
    this.size = size;
    this.out = Array.from({ length: size }, () => []);
  }

  /** True when `to` can be reached from `from` along the constraints (left → right). */
  reaches(from: number, to: number): boolean {
    if (from === to) return true;
    const seen = new Uint8Array(this.size);
    const stack = [from];
    seen[from] = 1;
    while (stack.length > 0) {
      for (const next of this.out[stack.pop()!]!) {
        if (next === to) return true;
        if (!seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    return false;
  }

  /**
   * Adds `x[right] − x[left] ≥ gap` unless it would close a cycle; returns whether it did.
   * `checked = false` skips the search, for constraints that cannot close one (the order of
   * a single row, added first).
   */
  add(left: number, right: number, gap: number, checked = true): boolean {
    if (checked && this.reaches(right, left)) return false;
    this.constraints.push({ left, right, gap });
    this.out[left]!.push(right);
    return true;
  }
}

interface Block {
  vars: number[];
  /** Σ weight × (desired − offset) over the members. */
  wposn: number;
  weight: number;
  posn: number;
  /** Constraints whose right variable is in the block (some may have become internal). */
  incoming: SeparationConstraint[];
}

/** Topological order of the variables (Kahn's algorithm, smallest index first among ready ones). */
function topologicalOrder(size: number, constraints: readonly SeparationConstraint[]): number[] {
  const indegree = new Array<number>(size).fill(0);
  const out: number[][] = Array.from({ length: size }, () => []);
  for (const c of constraints) {
    indegree[c.right]!++;
    out[c.left]!.push(c.right);
  }
  const ready: number[] = [];
  for (let v = 0; v < size; v++) if (indegree[v] === 0) ready.push(v);
  const order: number[] = [];
  for (let head = 0; head < ready.length; head++) {
    const v = ready[head]!;
    order.push(v);
    for (const next of out[v]!) if (--indegree[next]! === 0) ready.push(next);
  }
  if (order.length !== size) throw new Error('separation constraints form a cycle');
  return order;
}

/**
 * Solves the separation problem: returns one position per variable that satisfies every
 * constraint and stays close to the desired positions.
 */
export function solveSeparation(
  variables: readonly SeparationVariable[],
  constraints: readonly SeparationConstraint[],
): number[] {
  const size = variables.length;
  const order = topologicalOrder(size, constraints);
  const offset = new Array<number>(size).fill(0);
  const blockOf: Block[] = variables.map((v, i) => ({
    vars: [i],
    wposn: v.weight * v.desired,
    weight: v.weight,
    posn: v.desired,
    incoming: [],
  }));
  for (const c of constraints) blockOf[c.right]!.incoming.push(c);
  const position = (v: number) => blockOf[v]!.posn + offset[v]!;

  const mergeLeft = (start: Block) => {
    let block = start;
    for (;;) {
      let worst: SeparationConstraint | undefined;
      let worstViolation = EPSILON;
      for (const c of block.incoming) {
        if (blockOf[c.left] === block) continue;
        const violation = position(c.left) + c.gap - position(c.right);
        if (violation > worstViolation) {
          worst = c;
          worstViolation = violation;
        }
      }
      if (!worst) return;
      const left = blockOf[worst.left]!;
      // Offset of `block`'s frame inside `left`'s frame once the constraint is tight.
      const dist = offset[worst.left]! + worst.gap - offset[worst.right]!;
      let into: Block;
      let from: Block;
      let shift: number;
      if (block.vars.length > left.vars.length) {
        into = block;
        from = left;
        shift = -dist;
      } else {
        into = left;
        from = block;
        shift = dist;
      }
      for (const v of from.vars) {
        offset[v]! += shift;
        blockOf[v] = into;
        into.vars.push(v);
      }
      into.wposn += from.wposn - shift * from.weight;
      into.weight += from.weight;
      into.posn = into.wposn / into.weight;
      for (const c of from.incoming) into.incoming.push(c);
      into.incoming = into.incoming.filter((c) => blockOf[c.left] !== into);
      block = into;
    }
  };

  for (const v of order) mergeLeft(blockOf[v]!);

  const result = variables.map((_, v) => position(v));
  // Safety net: push anything still violated to the right, in topological order.
  const incoming: SeparationConstraint[][] = Array.from({ length: size }, () => []);
  for (const c of constraints) incoming[c.right]!.push(c);
  for (const v of order) {
    for (const c of incoming[v]!) {
      const least = result[c.left]! + c.gap;
      if (result[v]! < least) result[v] = least;
    }
  }
  return result;
}
