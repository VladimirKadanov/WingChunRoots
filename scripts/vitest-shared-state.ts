// A setup file of the `unit` project (vitest.config.mts), whose files share their worker's module
// graph (`isolate: false`). Vitest evaluates it again before each test file of that project, and
// its afterAll runs after the file's own hooks, so it sees what the file leaves to the next file of
// its worker: a changed process.env, fake timers still installed, or an app singleton on
// globalThis (`__wcr…`) replaced or deleted. Such a file belongs in ISOLATED. This catches it
// however it happened (a helper module, the code under test), where scripts/vitest-isolation.test.ts
// only reads the test files. It fails the file, then puts process.env and the timers back, so the
// next file starts clean. Only the names of variables are printed, never their values.

import { afterAll, vi } from 'vitest';

const envBefore = new Map(Object.entries(process.env));
const singletonsBefore = new Map(
  Object.getOwnPropertyNames(globalThis)
    .filter((name) => name.startsWith('__wcr'))
    .map((name) => [name, (globalThis as Record<string, unknown>)[name]] as const)
    .filter(([, value]) => value !== undefined),
);

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

  const replaced = [...singletonsBefore].filter(([name, value]) => (globalThis as Record<string, unknown>)[name] !== value).map(([name]) => name);
  if (replaced.length > 0) problems.push(`globalThis singletons replaced or deleted (${replaced.join(', ')})`);

  if (problems.length > 0) {
    throw new Error(
      `This file changes state that the next unit test file of its worker would see: ${problems.join('; ')}. ` +
        'Add it to ISOLATED in vitest.config.mts.',
    );
  }
});
