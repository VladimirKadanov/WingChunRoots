import { describe, expect, it } from 'vitest';

import { circleBounds, distanceKm, finderHref, finderParams, searchCenterOf, searchKey, viewAddress, withView } from './school-finder';

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

  it('reads the centre of a search around a point apart from the view', () => {
    expect(finderParams({ clat: '42.6975', clng: '23.3242', radius: '50', lat: '42.1354', lng: '24.7453', z: '9' })).toEqual({
      near: null,
      center: { lat: 42.6975, lng: 23.3242 },
      radius: 50,
      lineage: null,
      view: 'map',
      lat: 42.1354,
      lng: 24.7453,
      z: 9,
    });
    // Both keys or no centre.
    expect(finderParams({ clat: '42.6975', radius: '50' }).center).toBeUndefined();
    expect(finderParams({ clat: '95', clng: '23', radius: '50' }).center).toBeUndefined();
  });

  it('reads lat and lng with a radius and no place as the centre of an address from before clat and clng', () => {
    expect(finderParams({ radius: '50', lat: '42.6975', lng: '23.3242', z: '9' })).toMatchObject({ center: { lat: 42.6975, lng: 23.3242 }, lat: 42.6975, lng: 23.3242 });
    // With a place, lat and lng are only the view.
    expect(finderParams({ near: 'Sofia', radius: '50', lat: '42.6975', lng: '23.3242' }).center).toBeUndefined();
  });
});

describe('searchCenterOf', () => {
  it('is lat and lng only with a radius', () => {
    expect(searchCenterOf(finderParams({ lat: '42', lng: '23' }))).toBeNull();
    expect(searchCenterOf(finderParams({ lat: '42', lng: '23', radius: '50' }))).toEqual({ lat: 42, lng: 23 });
  });

  it('is clat and clng when the address has them, whatever the view', () => {
    expect(searchCenterOf(finderParams({ clat: '42', clng: '23', radius: '50', lat: '10', lng: '11' }))).toEqual({ lat: 42, lng: 23 });
    expect(searchCenterOf(finderParams({ clat: '42', clng: '23' }))).toEqual({ lat: 42, lng: 23 });
  });
});

describe('finderHref', () => {
  it('writes the keys in a fixed order and leaves the defaults out', () => {
    expect(finderHref({})).toBe('/schools');
    expect(finderHref({ view: 'map', near: 'Sofia', radius: 50, lineage: ROOT })).toBe(`/schools?near=Sofia&radius=50&lineage=${ROOT}`);
    expect(finderHref({ view: 'list', lat: 42.697712, lng: 23.321867, z: 9.123 })).toBe('/schools?view=list&lat=42.6977&lng=23.3219&z=9.12');
  });

  it('writes the centre of a search around a point in its own keys, before the view', () => {
    expect(finderHref({ center: { lat: 42.697512, lng: 23.324212 }, radius: 50, view: 'map', lat: 42.697512, lng: 23.324212, z: 9 })).toBe(
      '/schools?clat=42.6975&clng=23.3242&radius=50&lat=42.6975&lng=23.3242&z=9',
    );
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

describe('viewAddress', () => {
  it('never moves the search: a pan after "Search this area" keeps its centre, radius and lineage (review code-3)', () => {
    const searched = finderHref({ center: { lat: 42.6975, lng: 23.3242 }, radius: 50, lineage: ROOT, view: 'map', lat: 42.6975, lng: 23.3242, z: 9 });
    const panned = viewAddress(searched, { lat: 42.1354, lng: 24.7453, zoom: 9 });
    const before = finderParams(Object.fromEntries(new URL(searched, 'http://x.invalid').searchParams));
    const after = finderParams(Object.fromEntries(new URL(panned, 'http://x.invalid').searchParams));
    expect(searchCenterOf(after)).toEqual(searchCenterOf(before));
    expect(after).toMatchObject({ radius: 50, lineage: ROOT, lat: 42.1354, lng: 24.7453, z: 9 });
    expect(searchKey(panned)).toBe(searchKey(searched));
  });

  it('moves the centre of an address from before (lat and lng with a radius) to clat and clng, then the view', () => {
    const old = `/schools?radius=50&lat=42.6975&lng=23.3242&z=9`;
    const panned = viewAddress(old, { lat: 42.1354, lng: 24.7453, zoom: 9 });
    expect(panned).toBe('/schools?radius=50&lat=42.1354&lng=24.7453&z=9&clat=42.6975&clng=23.3242');
    expect(searchCenterOf(finderParams(Object.fromEntries(new URL(panned, 'http://x.invalid').searchParams)))).toEqual({ lat: 42.6975, lng: 23.3242 });
    expect(searchKey(panned)).toBe(searchKey(old));
  });

  it('keeps the radius of a search around a place', () => {
    expect(viewAddress('/schools?near=Sofia&radius=50', { lat: 1, lng: 2, zoom: 3 })).toBe('/schools?near=Sofia&radius=50&lat=1&lng=2&z=3');
  });

  it('drops a radius that has no centre, as the page answered no search', () => {
    expect(viewAddress(`/schools?near=&radius=50&lineage=${ROOT}`, { lat: 1, lng: 2, zoom: 3 })).toBe(`/schools?near=&lineage=${ROOT}&lat=1&lng=2&z=3`);
  });
});

describe('searchKey', () => {
  it('leaves the view out and tells one search from another', () => {
    expect(searchKey('/schools?near=Sofia&radius=50&lat=1&lng=2&z=3')).toBe(searchKey('/schools?near=Sofia&radius=50'));
    expect(searchKey('/schools?clat=42&clng=23&radius=50')).not.toBe(searchKey('/schools?clat=42.5&clng=23&radius=50'));
    expect(searchKey('/schools?near=Sofia&radius=50')).not.toBe(searchKey('/schools?near=Sofia&radius=25'));
    expect(searchKey(`/schools?lineage=${ROOT}`)).not.toBe(searchKey('/schools'));
    // A radius without a centre searches nothing.
    expect(searchKey('/schools?near=&radius=50&lineage=')).toBe(searchKey('/schools'));
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
