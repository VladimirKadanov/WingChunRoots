// drizzle-kit configuration (plan §6.2, milestone M01). Migrations are generated into drizzle/
// with `pnpm db:generate` and applied with `pnpm db:migrate`; `pnpm db:check` runs
// `drizzle-kit check` (conflicts between migrations from parallel branches), checks that the
// schema has no ungenerated changes and applies every migration to an empty database.
// drizzle-kit never connects to a database here, so no credentials are configured.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
