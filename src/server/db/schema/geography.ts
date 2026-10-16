// geography(Point,4326) for Drizzle (plan §6.2). Drizzle's built-in PostGIS type is geometry
// only, and on geometry(Point,4326) ST_DWithin(..., 50000) would measure in degrees and return
// the whole planet; on geography it measures in metres.
//
// Values go to PostgreSQL as EWKT text ('SRID=4326;POINT(lng lat)'), which geography_in accepts,
// and come back as hex EWKB, which parseEwkbPoint() decodes.

import { customType } from 'drizzle-orm/pg-core';

/** A WGS 84 point. Longitude first, as in GeoJSON and PostGIS. */
export interface GeoPoint {
  lng: number;
  lat: number;
}

const WGS84 = 4326;
const EWKB_SRID_FLAG = 0x2000_0000;
const WKB_POINT = 1;

/** EWKT for a WGS 84 point, after range checks. */
export function toEwkt(point: GeoPoint): string {
  const { lng, lat } = point;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error(`longitude out of range: ${lng}`);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`latitude out of range: ${lat}`);
  return `SRID=${WGS84};POINT(${lng} ${lat})`;
}

/** Decodes a hex (E)WKB 2D point as PostGIS returns it for geography and geometry columns. */
export function parseEwkbPoint(hex: string): GeoPoint {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error('not a hex EWKB value');
  const buf = Buffer.from(hex, 'hex');
  const littleEndian = buf.readUInt8(0) === 1;
  const readU32 = (offset: number) => (littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset));
  const readF64 = (offset: number) => (littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset));
  const type = readU32(1);
  let offset = 5;
  if (type & EWKB_SRID_FLAG) {
    const srid = readU32(offset);
    if (srid !== WGS84) throw new Error(`expected SRID ${WGS84}, got ${srid}`);
    offset += 4;
  }
  if ((type & 0xffff) !== WKB_POINT) throw new Error(`expected a POINT, got WKB type ${type & 0xffff}`);
  if (buf.length < offset + 16) throw new Error('EWKB point is truncated');
  return { lng: readF64(offset), lat: readF64(offset + 8) };
}

/** `geography(Point,4326)`; every such column gets a GiST index in its table definition. */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return `geography(Point,${WGS84})`;
  },
  toDriver(value: GeoPoint): string {
    return toEwkt(value);
  },
  fromDriver(value: string): GeoPoint {
    return parseEwkbPoint(value);
  },
});
