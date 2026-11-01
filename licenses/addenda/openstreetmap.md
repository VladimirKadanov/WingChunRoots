# OpenStreetMap and OpenFreeMap — the map of the school finder

<!-- Addendum for THIRD_PARTY_NOTICES.md and /legal/licenses (milestone M11, In scope 6). The
     map's tiles and styles are loaded by the browser from OpenFreeMap; nothing of them is in the
     repository. -->

The map on `/schools` is drawn in the browser by MapLibre GL JS (BSD-3-Clause, listed above) from
vector tiles and styles served by **OpenFreeMap**, <https://openfreemap.org/>. The map data is
**© OpenStreetMap contributors**, available under the **Open Database License** (ODbL 1.0),
<https://www.openstreetmap.org/copyright>. The map itself shows this attribution in its corner
(the attribution control is always on).

- **Styles:** OpenFreeMap "Positron" (light theme) and "Dark" (dark theme), loaded from
  `tiles.openfreemap.org`. The addresses are set in `src/server/geo/map-styles.ts`
  (`MAP_STYLES=local` uses the local test styles in `public/map-styles/`, which load nothing from
  outside).
- **Tiles:** OpenMapTiles schema, © OpenMapTiles (<https://openmaptiles.org/>), served by
  OpenFreeMap. The styles' fonts and sprites come from the same host.
- **What the browser sends to OpenFreeMap:** the requests for the tiles of the area on screen,
  with the reader's IP address, as every map service receives them. WingChunRoots sends no
  account, name or school data; the privacy policy names OpenFreeMap as a recipient.
