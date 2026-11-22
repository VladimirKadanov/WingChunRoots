// Whether /styleguide is served (phone review 2026-11, owner request "we dont need those pages for
// live"; docs/adr/0053-phone-layout.md). The style guide is a tool for building and testing the
// interface: `next dev` and the E2E build (`pnpm build:e2e`, WCR_E2E_BUILD=1: the tests use it as
// a fixture of every component) serve it; a deployable `pnpm build` answers "page not found".
// Both values are written into the build (next.config.ts `env`), so they are read literally.

export function styleguideShown(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.WCR_E2E_BUILD === '1';
}
