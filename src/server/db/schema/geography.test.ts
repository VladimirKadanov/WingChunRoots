import { describe, expect, it } from 'vitest';

import { parseEwkbPoint, toEwkt } from './geography';

describe('geography(Point,4326) helpers', () => {
  it('writes EWKT with longitude first', () => {
    expect(toEwkt({ lng: 24.75, lat: 42.15 })).toBe('SRID=4326;POINT(24.75 42.15)');
  });

  it('refuses coordinates out of range', () => {
    expect(() => toEwkt({ lng: 181, lat: 0 })).toThrow(/longitude/);
    expect(() => toEwkt({ lng: 0, lat: -91 })).toThrow(/latitude/);
    expect(() => toEwkt({ lng: Number.NaN, lat: 0 })).toThrow(/longitude/);
  });

  it('reads the little-endian EWKB that PostGIS returns', () => {
    // SELECT 'SRID=4326;POINT(24.75 42.15)'::geography  (PostGIS output)
    expect(parseEwkbPoint('0101000020E61000000000000000C038403333333333134540')).toEqual({ lng: 24.75, lat: 42.15 });
  });

  it('reads big-endian WKB without an SRID', () => {
    const buf = Buffer.alloc(21);
    buf.writeUInt8(0, 0);
    buf.writeUInt32BE(1, 1);
    buf.writeDoubleBE(-0.12574, 5);
    buf.writeDoubleBE(51.50853, 13);
    expect(parseEwkbPoint(buf.toString('hex'))).toEqual({ lng: -0.12574, lat: 51.50853 });
  });

  it('rejects other SRIDs, other geometry types and garbage', () => {
    expect(() => parseEwkbPoint('0101000020110F00000000000000C038403333333333134540')).toThrow(/SRID/);
    expect(() => parseEwkbPoint('0102000020E610000000000000')).toThrow(/POINT/);
    expect(() => parseEwkbPoint('zz')).toThrow(/hex/);
    expect(() => parseEwkbPoint('0101000020E6100000')).toThrow(/truncated/);
  });
});
