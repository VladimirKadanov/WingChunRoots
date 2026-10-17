import { describe, expect, it } from 'vitest';
import { DEMO_LINE, DEMO_LINE_LINKS, searchDemoLine } from './demo-lineage';

describe('demo line (D20: fictional only)', () => {
  it('uses demo- slugs', () => {
    for (const person of DEMO_LINE) expect(person.slug).toMatch(/^demo-/);
  });
  it('links each generation to the next', () => {
    expect(DEMO_LINE_LINKS).toHaveLength(DEMO_LINE.length - 1);
  });
});

describe('demo search', () => {
  it('finds a person by every spelling', () => {
    expect(searchDemoLine('盧嵐峰').map((p) => p.slug)).toEqual(['demo-lo-laam-fung']);
    expect(searchDemoLine('lou4 laam4').map((p) => p.slug)).toEqual(['demo-lo-laam-fung']);
    expect(searchDemoLine('laam fung').map((p) => p.slug)).toEqual(['demo-lo-laam-fung']);
    expect(searchDemoLine('Примеров').map((p) => p.slug)).toEqual(['demo-stefan-primerov']);
    expect(searchDemoLine('probnova').map((p) => p.slug)).toEqual(['demo-mira-probnova']);
    expect(searchDemoLine('vienna').map((p) => p.slug)).toEqual(['demo-dieter-fauxberg']);
  });
  it('returns nothing for an empty query', () => {
    expect(searchDemoLine('  ')).toEqual([]);
  });
});
