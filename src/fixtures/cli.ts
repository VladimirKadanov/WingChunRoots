// pnpm fixtures:generate — writes fixtures/lineage-600.json from the deterministic generator
// (milestone M01, In scope 10). `--check` only compares and fails when the file is out of date
// (the unit tests do the same).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from '../server/db/admin';
import { generateFixtures, LINEAGE_EXPORT_PATH, serializeLineageExport, toLineageExport } from './generate';

const file = path.join(repoRoot(), LINEAGE_EXPORT_PATH);
const text = serializeLineageExport(toLineageExport(generateFixtures()));

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    // missing file: reported below
  }
  if (current !== text) {
    console.error(`${LINEAGE_EXPORT_PATH} is out of date: run pnpm fixtures:generate`);
    process.exit(1);
  }
  console.log(`${LINEAGE_EXPORT_PATH} is up to date`);
} else {
  writeFileSync(file, text);
  console.log(`wrote ${LINEAGE_EXPORT_PATH} (${text.length} bytes)`);
}
