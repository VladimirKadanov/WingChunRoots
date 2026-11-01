# GeoNames — Creative Commons Attribution 4.0 (city data)

<!-- Addendum for THIRD_PARTY_NOTICES.md and /legal/licenses (milestone M11, In scope 1). The
     extract is data, not a package, so `pnpm licenses list` cannot name it. -->

The cities of WingChunRoots (the city of a school and of a profile, and the "Near" search of the
school finder) come from **GeoNames**, <https://www.geonames.org/>, licensed under the
**Creative Commons Attribution 4.0 International** licence (CC BY 4.0),
<https://creativecommons.org/licenses/by/4.0/>.

- **Data:** populated places of Bulgaria, Greece, Germany, the United Kingdom, the United States
  and Hong Kong above a population floor, with their English names, coordinates and population,
  and their Chinese and Cyrillic alternate names (used only to find a city by another spelling).
- **File:** `src/server/geo/data/geonames-places.tsv`, written by `scripts/geonames-extract.ts`
  (`pnpm geo:extract`). Its header names the source dump.
- **Source of this extract:** GeoNames `cities1000.txt` (dump of 2020-03-18) as redistributed
  unmodified in the npm package `cities-with-1000` 1.0.4. The official dump is
  <https://download.geonames.org/export/dump/>; the same script regenerates the extract from it.
- **Changes:** a subset of the rows and columns (the countries and fields above); the alternate
  names reduced to Chinese and Cyrillic script. No coordinates or names were edited.
- **No endorsement:** GeoNames does not endorse WingChunRoots or this use of its data.
