// Replaces next/cache with a no-op stub (scripts/lib/next-cache-stub.ts) for a script that runs the
// services outside Next.js (cacheTag and cacheLife throw there). Call it before the first import of
// a module that imports next/cache, then load that module with a dynamic import().

import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function stubNextCache(): void {
  const stub = pathToFileURL(path.resolve('scripts/lib/next-cache-stub.ts')).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'next/cache' || specifier === 'next/cache.js') return { url: stub, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}
