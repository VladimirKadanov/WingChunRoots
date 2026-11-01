import { describe, expect, it } from 'vitest';

import { circleBounds, distanceKm, finderHref, finderParams, searchCenterOf, withView } from './school-finder';

const ROOT = '0190f3a2-7b1c-7d2e-8f00-1234567890ab';

describe('finderParams', () => {
  it('reads every key of the address', () => {
    expect(finderParams({ near: ' Sofia ', radius: '25', lineage: ROOT.toUpperCase(), view: 'list', lat: '42.6977', lng: '23.3219', z: '9.5' })).toEqual({
      near: 'Sofia',
      radius: 25,
      lineage: ROOT,
      view: 'list',
      lat: 42.6977,
      lng: 23.3219,
      z: 9.5,
    });
  });

  it('drops what does not parse instead of failing', () => {
    expect(finderParams({ radius: '0', lineage: 'demo-root', view: 'grid', lat: '91', lng: '23', z: '30' })).toEqual({
      near: null,
      radius: null,
      lineage: null,
      view: 'map',
      lat: null,
      lng: null,
      z: null,
    });
    expect(finderParams({ radius: '501' }).radius).toBeNull();
    expect(finderParams({ radius: '12.5' }).radius).toBeNull();
    expect(finderParams({ lat: '1e2', lng: '0' }).lat).toBeNull();
    // A latitude without a longitude is no view.
    expect(finderParams({ lat: '42', z: '8' })).toMatchObject({ lat: null, lng: null, z: null });
  });

  it('takes the first of a repeated key and caps the place text', () => {
    expect(finderParams({ radius: ['10', '250'], near: 'x'.repeat(300) })).toMatchObject({ radius: 10, near: 'x'.repeat(100) });
  });
});

describe('searchCenterOf', () => {
  it('is lat and lng only with a radius', () => {
    expect(searchCenterOf(finderParams({ lat: '42', lng: '23' }))).toBeNull();
    expect(searchCenterOf(finderParams({ lat: '42', lng: '23', radius: '50' }))).toEqual({ lat: 42, lng: 23 });
  });
});

describe('finderHref', () => {
  it('writes the keys in a fixed order and leaves the defaults out', () => {
    expect(finderHref({})).toBe('/schools');
    expect(finderHref({ view: 'map', near: 'Sofia', radius: 50, lineage: ROOT })).toBe(`/schools?near=Sofia&radius=50&lineage=${ROOT}`);
    expect(finderHref({ view: 'list', lat: 42.697712, lng: 23.321867, z: 9.123 })).toBe('/schools?view=list&lat=42.6977&lng=23.3219&z=9.12');
  });
});

describe('withView', () => {
  it('replaces the view and keeps the other keys', () => {
    expect(withView(`/schools?radius=50&lineage=${ROOT}&lat=1&lng=2&z=3`, { lat: 42.69771, lng: 23.32187, zoom: 8.456 })).toBe(
      `/schools?radius=50&lineage=${ROOT}&lat=42.6977&lng=23.3219&z=8.46`,
    );
  });

  it('drops a radius that has no search centre', () => {
    expect(withView(`/schools?radius=50&lineage=${ROOT}`, { lat: 1, lng: 2, zoom: 3 }, false)).toBe(`/schools?lineage=${ROOT}&lat=1&lng=2&z=3`);
  });

  it('wraps a longitude panned round the world and clamps the zoom', () => {
    expect(withView('/schools', { lat: 10, lng: 200, zoom: 40 })).toBe('/schools?lat=10&lng=-160&z=17');
  });
});

describe('circleBounds and distanceKm', () => {
  it('spans the radius each way', () => {
    const center = { lat: 42.7, lng: 23.3 };
    const [west, south, east, north] = circleBounds(center, 50);
    expect(distanceKm(center, { lat: north, lng: center.lng })).toBeCloseTo(50, 0);
    expect(distanceKm(center, { lat: south, lng: center.lng })).toBeCloseTo(50, 0);
    expect(distanceKm(center, { lat: center.lat, lng: east })).toBeCloseTo(50, 0);
    expect(distanceKm(center, { lat: center.lat, lng: west })).toBeCloseTo(50, 0);
  });

  it('measures the great circle', () => {
    // One degree of latitude is about 111.2 km.
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 0);
  });
});
