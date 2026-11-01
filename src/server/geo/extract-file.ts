// Reading the committed GeoNames extract from disk (milestone M11, In scope 1). A module of its own
// that only the loaders import (db:seed, the places CLI and the tests): the app never reads the
// file, and keeping `node:fs` out of the modules the routes import keeps Next.js from tracing the
// whole repository into the server output.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { GEONAMES_EXTRACT_PATH, type GeoNamesPlace, parseExtract } from './geonames';

/** The committed extract, parsed. `root` is the repository (the working directory by default). */
export function readExtract(root: string = process.cwd()): GeoNamesPlace[] {
  return parseExtract(readFileSync(path.join(root, GEONAMES_EXTRACT_PATH), 'utf8'));
}
