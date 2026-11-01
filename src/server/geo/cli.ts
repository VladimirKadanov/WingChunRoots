// `pnpm geo:load` (milestone M11, In scope 1): loads the committed GeoNames extract
// (src/server/geo/data/geonames-places.tsv) into `place` as app_rw. Idempotent: a second run
// writes nothing; after `pnpm geo:extract` with a newer dump it updates what changed. db:seed loads
// the same extract itself, so this is for a database that is not seeded (M12's production-like run).

import { loadDotEnv } from '../db/dotenv';
import { closeDb, getDb } from '../db';
import { GEONAMES_ATTRIBUTION } from './geonames';
import { loadPlaces, readExtract } from './places';

async function main(): Promise<void> {
  loadDotEnv();
  const places = readExtract();
  const result = await loadPlaces(getDb(), places);
  console.log(`geo:load: ${result.places} places in the extract, ${result.written} written (${GEONAMES_ATTRIBUTION})`);
}

main()
  .catch((error: unknown) => {
    console.error(`geo:load: ${(error as Error).name}${(error as { code?: string }).code ? ` ${(error as { code?: string }).code}` : ''}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
