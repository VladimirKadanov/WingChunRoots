// Pure parts of scripts/vitest-shared-state.ts, unit-tested in shared-state.test.ts: a snapshot of
// an object's own properties, and which of them were later replaced or deleted. New properties do
// not count: libraries add lazy globals of their own on first use.

export type Entry = {
  descriptor: PropertyDescriptor;
  /** What reading the property returned; compared for an accessor whose getter answers the same twice. */
  value: unknown;
  stable: boolean;
};

function read(target: object, key: PropertyKey): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: Reflect.get(target, key) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** Every own property of `target` (string and symbol keys) as it is now. */
export function snapshot(target: object): Map<PropertyKey, Entry> {
  const entries = new Map<PropertyKey, Entry>();
  for (const key of Reflect.ownKeys(target)) {
    // Read before taking the descriptor: Node defines some globals as getters that turn
    // themselves into a plain value on the first read.
    const first = read(target, key);
    const second = read(target, key);
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined) continue;
    entries.set(key, { descriptor, value: second.value, stable: first.ok && second.ok && Object.is(first.value, second.value) });
  }
  return entries;
}

function unchanged(target: object, key: PropertyKey, entry: Entry): boolean {
  const now = Reflect.getOwnPropertyDescriptor(target, key);
  if (now === undefined) return false;
  const before = entry.descriptor;
  if ('value' in before || 'value' in now) return 'value' in before && 'value' in now && Object.is(before.value, now.value);
  if (before.get !== now.get || before.set !== now.set) return false;
  // A getter with a setter (globalThis.performance) keeps its descriptor when it is assigned.
  if (!entry.stable) return true;
  const value = read(target, key);
  return value.ok && Object.is(value.value, entry.value);
}

function restore(target: object, key: PropertyKey, entry: Entry): void {
  try {
    Reflect.defineProperty(target, key, entry.descriptor);
    if (entry.stable && !('value' in entry.descriptor) && entry.descriptor.set) Reflect.set(target, key, entry.value);
  } catch {
    // A property that cannot be put back is still reported.
  }
}

/**
 * The keys of `before` that `target` no longer has as they were (replaced, redefined or deleted),
 * each put back as far as it can be, so the next file starts clean.
 */
export function replacedKeys(target: object, before: Map<PropertyKey, Entry>): PropertyKey[] {
  const replaced: PropertyKey[] = [];
  for (const [key, entry] of before) {
    if (unchanged(target, key, entry)) continue;
    replaced.push(key);
    restore(target, key, entry);
  }
  return replaced;
}

/** `globalThis.fetch`, `globalThis[Symbol(x)]`: a name for a message, never the value. */
export function label(name: string, key: PropertyKey): string {
  return typeof key === 'symbol' ? `${name}[${String(key)}]` : `${name}.${key}`;
}
