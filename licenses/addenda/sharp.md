# sharp 0.35.5 and libvips (@img/sharp-libvips 1.3.4) — Apache-2.0 and LGPL-3.0-or-later

<!-- Addendum for THIRD_PARTY_NOTICES.md and /legal/licenses (M00b; a direct dependency since
     M10a). `pnpm notices` checks the two versions in the title against pnpm-lock.yaml. -->

**sharp 0.35.5** re-encodes uploaded evidence images on the server so that EXIF metadata and
GPS positions never reach storage (M10a), and Next.js uses it for server-side image
optimisation. It comes with the prebuilt binaries for the platform the server runs on:
`@img/sharp-<platform>` 0.35.5 and `@img/sharp-libvips-<platform>` **1.3.4** (libvips 8.18.7
and the libraries it links). They run only on the server and are never sent to the browser.
`pnpm licenses list --prod` leaves the optional platform packages out, and which one is
installed depends on the machine, so they are named here once for every platform.

- **sharp and `@img/sharp-<platform>`:** Apache License 2.0, Copyright Lovell Fuller and
  contributors. Source: <https://github.com/lovell/sharp/tree/v0.35.5>. The Apache-2.0 text
  is listed under "Licence texts" with the other Apache-2.0 packages.
- **`@img/sharp-libvips-<platform>`:** GNU Lesser General Public License v3.0 or later
  (libvips, glib, libheif, librsvg and others), with parts under BSD, MIT, MPL-1.1 and the
  other licences listed in the package's README. Source and build scripts:
  <https://github.com/lovell/sharp-libvips/tree/v1.3.4>; libvips:
  <https://github.com/libvips/libvips>; licence text: <https://www.gnu.org/licenses/lgpl-3.0.txt>.

The LGPL libraries are loaded as shared libraries, unmodified. You may replace them with
versions you build from the sources above.
