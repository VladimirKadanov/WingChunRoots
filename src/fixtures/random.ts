// A small deterministic PRNG for the fixtures (sfc32 seeded through splitmix32). Same seed, same
// sequence, on every platform and Node version: no Math.random, no clock.

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** A new array with the items in random order (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  bytes(n: number): Uint8Array;
}

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRandom(seed: number): Random {
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();
  const u32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 16; i++) u32();

  const next = () => u32() / 0x1_0000_0000;
  const int = (min: number, max: number) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`bad range ${min}..${max}`);
    return min + Math.floor(next() * (max - min + 1));
  };
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[int(0, items.length - 1)]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    bytes(n: number): Uint8Array {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = u32() & 0xff;
      return out;
    },
  };
}
