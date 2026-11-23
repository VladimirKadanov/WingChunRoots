import { afterEach, describe, expect, it, vi } from 'vitest';

import { styleguideShown } from './styleguide';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('styleguideShown', () => {
  it('serves the style guide in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WCR_E2E_BUILD', '');
    expect(styleguideShown()).toBe(true);
  });

  it('serves it in the E2E build, which the tests use as a fixture', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WCR_E2E_BUILD', '1');
    expect(styleguideShown()).toBe(true);
  });

  it('answers "page not found" in a deployable build', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WCR_E2E_BUILD', '');
    expect(styleguideShown()).toBe(false);
  });
});
