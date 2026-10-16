// A small excerpt of GeoNames `cities1000` for the default countries of M11 (BG, GR, DE, GB, US,
// HK). Source: GeoNames (https://www.geonames.org/), licensed CC BY 4.0; dump of 2020-03-18 as
// redistributed in the npm package cities-with-1000@1.0.4 (download.geonames.org is not
// reachable from the cloud session). Columns kept as in the dump: geonameid, name, asciiname,
// latitude, longitude, feature code, country code, admin1 code, population, timezone.
// The schools that use these cities are fictional (D20); the cities are real.

export interface GeoNamesCity {
  geonamesId: number;
  name: string;
  asciiName: string;
  lat: number;
  lng: number;
  featureCode: string;
  countryCode: string;
  admin1Code: string;
  population: number;
  timezone: string;
}

export const GEONAMES_ATTRIBUTION = 'GeoNames (https://www.geonames.org/), CC BY 4.0';

export const GEONAMES_CITIES: readonly GeoNamesCity[] = [
  { geonamesId: 727011, name: 'Sofia', asciiName: 'Sofia', lat: 42.69751, lng: 23.32415, featureCode: 'PPLC', countryCode: 'BG', admin1Code: '42', population: 1152556, timezone: 'Europe/Sofia' },
  { geonamesId: 728193, name: 'Plovdiv', asciiName: 'Plovdiv', lat: 42.15, lng: 24.75, featureCode: 'PPLA', countryCode: 'BG', admin1Code: '51', population: 340494, timezone: 'Europe/Sofia' },
  { geonamesId: 726050, name: 'Varna', asciiName: 'Varna', lat: 43.21667, lng: 27.91667, featureCode: 'PPLA', countryCode: 'BG', admin1Code: '61', population: 312770, timezone: 'Europe/Sofia' },
  { geonamesId: 264371, name: 'Athens', asciiName: 'Athens', lat: 37.98376, lng: 23.72784, featureCode: 'PPLC', countryCode: 'GR', admin1Code: 'ESYE31', population: 664046, timezone: 'Europe/Athens' },
  { geonamesId: 734077, name: 'Thessaloníki', asciiName: 'Thessaloniki', lat: 40.64361, lng: 22.93086, featureCode: 'PPLA', countryCode: 'GR', admin1Code: 'ESYE12', population: 354290, timezone: 'Europe/Athens' },
  { geonamesId: 2950159, name: 'Berlin', asciiName: 'Berlin', lat: 52.52437, lng: 13.41053, featureCode: 'PPLC', countryCode: 'DE', admin1Code: '16', population: 3426354, timezone: 'Europe/Berlin' },
  { geonamesId: 2911298, name: 'Hamburg', asciiName: 'Hamburg', lat: 53.55073, lng: 9.99302, featureCode: 'PPLA', countryCode: 'DE', admin1Code: '04', population: 1739117, timezone: 'Europe/Berlin' },
  { geonamesId: 2867714, name: 'Munich', asciiName: 'Munich', lat: 48.13743, lng: 11.57549, featureCode: 'PPLA', countryCode: 'DE', admin1Code: '02', population: 1260391, timezone: 'Europe/Berlin' },
  { geonamesId: 2643743, name: 'London', asciiName: 'London', lat: 51.50853, lng: -0.12574, featureCode: 'PPLC', countryCode: 'GB', admin1Code: 'ENG', population: 7556900, timezone: 'Europe/London' },
  { geonamesId: 2655603, name: 'Birmingham', asciiName: 'Birmingham', lat: 52.48142, lng: -1.89983, featureCode: 'PPLA2', countryCode: 'GB', admin1Code: 'ENG', population: 984333, timezone: 'Europe/London' },
  { geonamesId: 5128581, name: 'New York City', asciiName: 'New York City', lat: 40.71427, lng: -74.00597, featureCode: 'PPL', countryCode: 'US', admin1Code: 'NY', population: 8175133, timezone: 'America/New_York' },
  { geonamesId: 5368361, name: 'Los Angeles', asciiName: 'Los Angeles', lat: 34.05223, lng: -118.24368, featureCode: 'PPLA2', countryCode: 'US', admin1Code: 'CA', population: 3971883, timezone: 'America/Los_Angeles' },
  { geonamesId: 4887398, name: 'Chicago', asciiName: 'Chicago', lat: 41.85003, lng: -87.65005, featureCode: 'PPLA2', countryCode: 'US', admin1Code: 'IL', population: 2720546, timezone: 'America/Chicago' },
  { geonamesId: 1819729, name: 'Hong Kong', asciiName: 'Hong Kong', lat: 22.27832, lng: 114.17469, featureCode: 'PPLC', countryCode: 'HK', admin1Code: 'HCW', population: 7012738, timezone: 'Asia/Hong_Kong' },
  { geonamesId: 1819609, name: 'Kowloon', asciiName: 'Kowloon', lat: 22.31667, lng: 114.18333, featureCode: 'PPLA', countryCode: 'HK', admin1Code: 'KKC', population: 2019533, timezone: 'Asia/Hong_Kong' },
];
