// The request scope of a Better Auth request (src/server/auth/request-scope.ts).

import { describe, expect, it, vi } from 'vitest';

import { hold, requestScope, runAuthRequest, settle } from './request-scope';

describe('runAuthRequest', () => {
  it('gives back a reservation that nobody settled, once, when the request ends', async () => {
    const giveBack = vi.fn(async () => undefined);
    const answer = await runAuthRequest(async () => {
      hold('password', 'sign-in:abc', giveBack);
      return 'answered';
    });
    expect(answer).toBe('answered');
    expect(giveBack).toHaveBeenCalledTimes(1);
  });

  it('gives it back when the request throws too', async () => {
    const giveBack = vi.fn(async () => undefined);
    await expect(
      runAuthRequest(async () => {
        hold('password', 'sign-in:abc', giveBack);
        throw new Error('unexpected');
      }),
    ).rejects.toThrow('unexpected');
    expect(giveBack).toHaveBeenCalledTimes(1);
  });

  it('leaves a settled reservation to whoever settled it', async () => {
    const giveBack = vi.fn(async () => undefined);
    await runAuthRequest(async () => {
      hold('password', 'sign-in:abc', giveBack);
      await Promise.resolve();
      expect(settle('password')).toBe('sign-in:abc');
      expect(settle('password')).toBeNull();
    });
    expect(giveBack).not.toHaveBeenCalled();
  });

  it('keeps each request apart, also when they run at the same time', async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all(
      ['first', 'second'].map((name) =>
        runAuthRequest(async () => {
          requestScope()!.resetEmail = `${name}@example.test`;
          await new Promise((resolve) => setTimeout(resolve, name === 'first' ? 20 : 5));
          seen.push(requestScope()?.resetEmail);
        }),
      ),
    );
    expect(seen.sort()).toEqual(['first@example.test', 'second@example.test']);
  });

  it('a failed give-back is logged, and the others still run', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const second = vi.fn(async () => undefined);
    await runAuthRequest(async () => {
      hold('totp-claim', 'totp:x', async () => {
        throw new Error('database went away');
      });
      hold('second-factor', 'user-1', second);
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('outside a request scope', () => {
  it('holds nothing and settles nothing (the caller works the key out itself)', () => {
    hold('password', 'sign-in:abc', async () => undefined);
    expect(requestScope()).toBeUndefined();
    expect(settle('password')).toBeUndefined();
  });
});

describe('two copies of this module (the bundler puts one in each server chunk)', () => {
  it('share one scope: a hook of one copy sees what runAuthRequest() of the other set', async () => {
    // Fix round 3: the Better Auth instance is one per process (config.ts), created from whichever
    // chunk asked first; its hooks import that chunk's copy of this module, while the route or a
    // Server Action of another chunk runs runAuthRequest() from its own copy.
    vi.resetModules();
    const route = await import('./request-scope');
    vi.resetModules();
    const hooks = await import('./request-scope');
    expect(hooks).not.toBe(route);

    const giveBack = vi.fn(async () => undefined);
    await route.runAuthRequest(async () => {
      const scope = hooks.requestScope();
      expect(scope).toBeDefined();
      scope!.resetEmail = 'demo-scope@example.test';
      hooks.hold('password', 'sign-in:abc', giveBack);
      expect(route.requestScope()?.resetEmail).toBe('demo-scope@example.test');
    });
    // The reservation the other copy held is given back by the copy that ran the request.
    expect(giveBack).toHaveBeenCalledTimes(1);
  });
});
