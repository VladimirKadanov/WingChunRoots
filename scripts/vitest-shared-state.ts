// A setup file of the `unit` project (vitest.config.mts), whose files share their worker's module
// graph (`isolate: false`). Vitest evaluates it again before each test file of that project, and
// its afterAll runs after the file's own hooks, so it sees what the file leaves to the next file of
// its worker: a changed process.env, fake timers still installed, or a property of globalThis,
// Date, Math, console or JSON replaced or deleted (an app singleton such as __wcrAuth, fetch,
// Date.now, console.error). Such a file belongs in ISOLATED. This catches it however it happened
// (a helper module, the code under test), where scripts/vitest-isolation.test.ts only reads the
// test files. It fails the file, then puts the state back, so the next file starts clean. Only
// the names of variables and properties are printed, never their values.
//
// New properties are allowed: libraries add lazy globals of their own on first use. The methods of
// `process` are not compared: graceful-fs replaces process.cwd and process.chdir once per worker
// when a module loads it; the static guard reads the test files for writes to process.

import { afterAll, vi } from 'vitest';

import { label, replacedKeys, snapshot } from './lib/shared-state';

/** The built-in objects whose own properties a file must leave as it found them. */
const WATCHED: ReadonlyArray<readonly [string, object]> = [
  ['globalThis', globalThis],
  ['Date', Date],
  ['Math', Math],
  ['console', console],
  ['JSON', JSON],
];

const envBefore = new Map(Object.entries(process.env));
const builtinsBefore = WATCHED.map(([name, target]) => [name, target, snapshot(target)] as const);

afterAll(() => {
  const problems: string[] = [];

  const changed = [...new Set([...envBefore.keys(), ...Object.keys(process.env)])].filter((name) => envBefore.get(name) !== process.env[name]);
  if (changed.length > 0) {
    problems.push(`process.env changed (${changed.sort().join(', ')})`);
    for (const name of changed) {
      const value = envBefore.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  if (vi.isFakeTimers()) {
    problems.push('fake timers are still installed');
    vi.useRealTimers();
  }

  // Vitest restores the vi.spyOn spies after each file (vi.restoreAllMocks() in its runner);
  // doing it here first keeps a spy on console.error or Date.now from counting as a change.
  vi.restoreAllMocks();
  const replaced = builtinsBefore.flatMap(([name, target, before]) => replacedKeys(target, before).map((key) => label(name, key)));
  if (replaced.length > 0) problems.push(`built-in properties replaced or deleted (${replaced.join(', ')})`);

  if (problems.length > 0) {
    throw new Error(
      `This file changes state that the next unit test file of its worker would see: ${problems.join('; ')}. ` +
        'Add it to ISOLATED in vitest.config.mts.',
    );
  }
});
