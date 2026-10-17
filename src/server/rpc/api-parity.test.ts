// API parity (plan §6.8; milestone M02, Done when 4): every Server Action is a thin wrapper over
// an oRPC procedure or a Better Auth endpoint (src/server/rpc/parity.ts), so the web forms never
// have a path to a mutation that the API lacks.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SERVER_ACTION_TARGETS } from './parity';
import { router } from './router';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Files whose first statement is the 'use server' directive. */
function serverActionFiles(): string[] {
  return sourceFiles(path.join(ROOT, 'src')).filter((file) => {
    const code = readFileSync(file, 'utf8').replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/, '');
    return /^['"]use server['"]/.test(code);
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/** The exported functions of a 'use server' file; any other export fails the test. */
function exportedActions(file: string): { names: string[]; other: string[] } {
  const code = readFileSync(file, 'utf8');
  const names = [...code.matchAll(/^export\s+async\s+function\s+(\w+)/gm)].map((m) => m[1]!);
  const other = [...code.matchAll(/^export\s+(?!async\s+function\s)(?!type\s|interface\s)(.*)$/gm)].map((m) => m[1]!);
  return { names, other };
}

function procedureAt(dotted: string): unknown {
  let node: unknown = router;
  for (const key of dotted.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  return node;
}

describe('Server Actions and the API', () => {
  const files = serverActionFiles();
  const found = new Map<string, string>();
  for (const file of files) {
    const { names } = exportedActions(file);
    for (const name of names) found.set(`${relative(file)}#${name}`, file);
  }

  it('finds the Server Actions of the app', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(found.size).toBeGreaterThan(0);
  });

  it("'use server' files export only async functions", () => {
    for (const file of files) expect(exportedActions(file).other, relative(file)).toEqual([]);
  });

  it('every Server Action is listed in parity.ts, and every listed action exists', () => {
    expect([...found.keys()].sort()).toEqual(Object.keys(SERVER_ACTION_TARGETS).sort());
  });

  it('every oRPC target is a procedure of the router, and the action calls it', () => {
    for (const [key, target] of Object.entries(SERVER_ACTION_TARGETS)) {
      if (!('rpc' in target)) continue;
      const source = readFileSync(path.join(ROOT, key.split('#')[0]!), 'utf8');
      for (const dotted of target.rpc) {
        const procedure = procedureAt(dotted) as { '~orpc'?: { route?: { path?: string } } } | undefined;
        expect(procedure?.['~orpc'], `${key} → ${dotted}`).toBeDefined();
        // Every procedure has an OpenAPI route (/api/v1), so a native client reaches it.
        expect(procedure?.['~orpc']?.route?.path, `${dotted} has an OpenAPI path`).toMatch(/^\//);
        expect(source, `${key} calls ${dotted}`).toContain(`.${dotted}(`);
      }
    }
  });

  describe('Better Auth targets', () => {
    beforeAll(() => {
      // createAuth() needs settings, not a database connection (the pool connects on first query).
      vi.stubEnv('BETTER_AUTH_SECRET', 'parity-test-secret-0000000000000000');
      vi.stubEnv('IP_HMAC_KEY', 'parity-test-key-000000000000000000000');
      vi.stubEnv('APP_URL', 'http://127.0.0.1:3999');
      vi.stubEnv('DATABASE_URL', 'postgres://parity@127.0.0.1:1/parity_unused');
      vi.stubEnv('DB_APP_RW_PASSWORD', 'parity-unused');
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it('every Better Auth target is an endpoint that is served, and the action calls it', async () => {
      const { createAuth, DISABLED_AUTH_PATHS } = await import('../auth/config');
      const auth = createAuth();
      const served = new Set(
        Object.values(auth.api as Record<string, { path?: string }>)
          .map((endpoint) => endpoint.path)
          .filter((p): p is string => typeof p === 'string' && !DISABLED_AUTH_PATHS.includes(p)),
      );
      for (const [key, target] of Object.entries(SERVER_ACTION_TARGETS)) {
        if (!('auth' in target)) continue;
        const source = readFileSync(path.join(ROOT, key.split('#')[0]!), 'utf8');
        for (const endpoint of target.auth) {
          expect(served.has(endpoint), `${key} → ${endpoint} is served under /api/auth`).toBe(true);
          expect(source, `${key} calls ${endpoint}`).toContain(`'${endpoint}'`);
        }
      }
    });
  });
});
