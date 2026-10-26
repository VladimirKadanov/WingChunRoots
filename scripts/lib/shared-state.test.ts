import { describe, expect, it } from 'vitest';

import { label, replacedKeys, snapshot } from './shared-state';

/** A getter that turns itself into a plain value on the first read, as Node's lazy globals do. */
function lazy(target: object, key: string, make: () => unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get() {
      const value = make();
      Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value });
      return value;
    },
  });
}

/** A getter with a setter that keeps its descriptor when assigned, as globalThis.performance does. */
function replaceable(target: object, key: string, initial: unknown): void {
  let value = initial;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: (next: unknown) => {
      value = next;
    },
  });
}

describe('snapshot and replacedKeys (scripts/vitest-shared-state.ts)', () => {
  it('finds a replaced, redefined or deleted property and puts it back', () => {
    const tag = Symbol('tag');
    const now = () => 1;
    const target: Record<PropertyKey, unknown> = { fetch: () => 'real', now, kept: 1, gone: 'x', [tag]: 'a' };
    const before = snapshot(target);

    target.fetch = () => 'fake';
    Object.defineProperty(target, 'now', { get: () => now });
    delete target.gone;
    target[tag] = 'b';

    expect(replacedKeys(target, before).map((key) => label('globalThis', key))).toEqual([
      'globalThis.fetch',
      'globalThis.now',
      'globalThis.gone',
      'globalThis[Symbol(tag)]',
    ]);
    expect((target.fetch as () => string)()).toBe('real');
    expect(Object.getOwnPropertyDescriptor(target, 'now')).toMatchObject({ value: now, writable: true });
    expect(target.gone).toBe('x');
    expect(target[tag]).toBe('a');
    expect(replacedKeys(target, before)).toEqual([]);
  });

  it('allows new properties and a property set back to its value', () => {
    const target: Record<string, unknown> = { a: 1 };
    const before = snapshot(target);
    target.added = 2;
    target.a = 3;
    target.a = 1;
    expect(replacedKeys(target, before)).toEqual([]);
  });

  it('does not count a lazy global that became a plain value, but counts it when it is replaced', () => {
    const real = { name: 'real' };
    const target = {};
    lazy(target, 'Response', () => real);
    const before = snapshot(target);
    expect(replacedKeys(target, before)).toEqual([]);

    Object.assign(target, { Response: { name: 'fake' } });
    expect(replacedKeys(target, before)).toEqual(['Response']);
    expect((target as { Response: unknown }).Response).toBe(real);
  });

  it('counts an accessor assigned through its setter and puts the value back', () => {
    const real = { now: () => 1 };
    const target = {};
    replaceable(target, 'performance', real);
    const before = snapshot(target);

    Object.assign(target, { performance: { now: () => 0 } });
    expect(replacedKeys(target, before)).toEqual(['performance']);
    expect((target as { performance: unknown }).performance).toBe(real);
  });

  it('skips the value of a getter that answers differently on each read', () => {
    let calls = 0;
    const target = {};
    Object.defineProperty(target, 'fresh', { configurable: true, get: () => ({ call: ++calls }) });
    const before = snapshot(target);
    expect(replacedKeys(target, before)).toEqual([]);
  });
});
