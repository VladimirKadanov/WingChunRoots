// The map's styles (milestone M11, In scope 6; plan §5.3 "the map rule"): one for the dark theme
// and one for the light, and the map switches between them with the theme.
//
// - OpenFreeMap (https://openfreemap.org): free vector tiles from OpenStreetMap data with no key and
//   no account. Its servers receive the reader's IP address and the tiles the map asks for, so the
//   privacy policy draft names OpenFreeMap as a recipient (docs/legal/privacy-policy.draft.md).
//   DEFAULT (no D number; docs/adr/0013-schools-map.md): Positron for the light theme and Dark for
//   the dark one; the addresses were not reachable from the cloud sessions where M11 was built
//   (docs/plan/questions/M11.md, question 4).
// - The local minimal styles in public/map-styles/ (a ground and a graticule, no tiles, no glyphs,
//   no external request): the E2E build always uses them (tests make no external request), and any
//   build does when MAP_STYLES=local (a machine without access to OpenFreeMap). Self-hosted
//   Protomaps tiles come with the hosting decision (plan §2.3, §3.3).
//
// Read per request by the /schools page (its server part), which hands the addresses to the map.

export interface MapStyles {
  light: string;
  dark: string;
  /** Which set: OpenFreeMap, or the local styles (tests, MAP_STYLES=local). */
  source: 'openfreemap' | 'local';
}

export const OPENFREEMAP_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

export const LOCAL_STYLES = {
  light: '/map-styles/light.json',
  dark: '/map-styles/dark.json',
} as const;

/**
 * Whether this server uses the local styles. WCR_E2E_BUILD is written into the build
 * (next.config.ts `env`), so it is read as `process.env.WCR_E2E_BUILD` itself; MAP_STYLES is read
 * when the page renders.
 */
export function usesLocalStyles(): boolean {
  return process.env.WCR_E2E_BUILD === '1' || process.env.MAP_STYLES === 'local';
}

/** The styles this server hands to the map. */
export function mapStyles(local: boolean = usesLocalStyles()): MapStyles {
  return local ? { ...LOCAL_STYLES, source: 'local' } : { ...OPENFREEMAP_STYLES, source: 'openfreemap' };
}
