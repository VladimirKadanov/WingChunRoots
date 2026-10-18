// API parity (plan §6.8; milestone M02, Done when 4): every Server Action is a thin wrapper over
// an oRPC procedure or a Better Auth endpoint (src/server/rpc/parity.ts), so the web forms never
// have a path to a mutation that the API lacks.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
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

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** The top-level functions and constants of a file, by name (not its imports). */
function topLevelDeclarations(source: ts.SourceFile): Map<string, ts.Node> {
  const declarations = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
      }
    }
  }
  return declarations;
}

/**
 * The source of an exported action and of the functions and constants of its own file that it
 * uses, directly or through each other: what the action actually runs. A call that only another
 * action of the same file makes is not in it.
 */
function actionSource(file: string, name: string): string {
  const source = parse(file);
  const declarations = topLevelDeclarations(source);
  const seen = new Set<string>();
  const parts: string[] = [];
  const visit = (declarationName: string) => {
    const node = declarations.get(declarationName);
    if (!node || seen.has(declarationName)) return;
    seen.add(declarationName);
    parts.push(node.getText(source));
    const walk = (child: ts.Node) => {
      if (ts.isIdentifier(child) && declarations.has(child.text)) visit(child.text);
      ts.forEachChild(child, walk);
    };
    ts.forEachChild(node, walk);
  };
  visit(name);
  return parts.join('\n');
}

/** Every 'use server' directive in a file: a statement that is only the string 'use server'. */
function serverDirectives(source: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'use server') found.push(node);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return found;
}

/** The module specifiers a file imports or re-exports. */
function importsOf(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
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

  it("'use server' is only ever a file's first statement: no inline Server Actions outside the table", () => {
    const inline: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src'))) {
      const source = parse(file);
      for (const directive of serverDirectives(source)) {
        if (directive !== source.statements[0]) {
          const { line } = source.getLineAndCharacterOfPosition(directive.getStart(source));
          inline.push(`${relative(file)}:${line + 1}`);
        }
      }
    }
    expect(inline).toEqual([]);
  });

  it("'use server' files reach the services and the database only through oRPC or Better Auth", () => {
    for (const file of files) {
      const direct = importsOf(parse(file)).filter((specifier) => /(^|\/)server\/(services|db)(\/|$)/.test(specifier));
      expect(direct, `${relative(file)} imports services or the database directly`).toEqual([]);
    }
  });

  it('every Server Action is listed in parity.ts, and every listed action exists', () => {
    expect([...found.keys()].sort()).toEqual(Object.keys(SERVER_ACTION_TARGETS).sort());
  });

  it('every oRPC target is a procedure of the router, and the action calls it', () => {
    for (const [key, target] of Object.entries(SERVER_ACTION_TARGETS)) {
      expect((target.rpc?.length ?? 0) + (target.auth?.length ?? 0), `${key} names what it wraps`).toBeGreaterThan(0);
      if (!target.rpc) continue;
      const [file, name] = key.split('#') as [string, string];
      const source = actionSource(path.join(ROOT, file), name);
      for (const dotted of target.rpc) {
        const procedure = procedureAt(dotted) as { '~orpc'?: { route?: { path?: string } } } | undefined;
        expect(procedure?.['~orpc'], `${key} → ${dotted}`).toBeDefined();
        // Every procedure has an OpenAPI route (/api/v1), so a native client reaches it.
        expect(procedure?.['~orpc']?.route?.path, `${dotted} has an OpenAPI path`).toMatch(/^\//);
        expect(source, `${key} calls ${dotted}`).toContain(`.${dotted}(`);
      }
    }
  });

  it('reads only what the action runs: a call made by another action of the file does not count', () => {
    // verifySecondFactorAction calls /two-factor/verify-totp; signInAction does not.
    const file = path.join(ROOT, 'src/app/sign-in/actions.ts');
    expect(actionSource(file, 'verifySecondFactorAction')).toContain("'/two-factor/verify-totp'");
    expect(actionSource(file, 'signInAction')).not.toContain("'/two-factor/verify-totp'");
    // Both reach account.landing through the file's helper.
    expect(actionSource(file, 'signInAction')).toContain('.account.landing(');
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
        if (!target.auth) continue;
        const [file, name] = key.split('#') as [string, string];
        const source = actionSource(path.join(ROOT, file), name);
        for (const endpoint of target.auth) {
          expect(served.has(endpoint), `${key} → ${endpoint} is served under /api/auth`).toBe(true);
          expect(source, `${key} calls ${endpoint}`).toContain(`'${endpoint}'`);
        }
      }
    });

    it('every endpoint served over HTTP that checks an existing password counts the attempt (hooks.ts)', async () => {
      const { createAuth, DISABLED_AUTH_PATHS } = await import('../auth/config');
      const { PASSWORD_GATED_PATHS } = await import('../auth/hooks');
      type Endpoint = { path?: string; options?: { body?: { shape?: Record<string, unknown> }; metadata?: { SERVER_ONLY?: boolean } } };
      const checksPassword = Object.values(createAuth().api as Record<string, Endpoint>)
        .filter((endpoint) => typeof endpoint.path === 'string' && !DISABLED_AUTH_PATHS.includes(endpoint.path))
        .filter((endpoint) => !endpoint.options?.metadata?.SERVER_ONLY)
        .filter((endpoint) => {
          const shape = endpoint.options?.body?.shape ?? {};
          return 'password' in shape || 'currentPassword' in shape;
        })
        .map((endpoint) => endpoint.path as string);
      // Sign-up sets a password; sign-in reserves its attempts itself; the rest are gated.
      const counted = new Set(['/sign-up/email', '/sign-in/email', ...PASSWORD_GATED_PATHS]);
      expect(checksPassword.filter((p) => !counted.has(p))).toEqual([]);
      expect(checksPassword).toEqual(expect.arrayContaining(['/sign-in/email', '/change-password', '/two-factor/enable']));
    });
  });
});
