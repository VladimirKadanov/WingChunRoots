import { describe, expect, it } from 'vitest';

import { chosenRoute, longestRoute } from './lineage-card-route';

const card = { paths: { paths: [{ personIds: ['a', 'b'] }, { personIds: ['c', 'd', 'e'] }, { personIds: ['f', 'g', 'h'] }] } };

describe('the route a lineage card shows (ADR 0045)', () => {
  it('shows the longest route first; of equal ones, the first lineage.paths gives', () => {
    expect(longestRoute(card.paths)).toBe(1);
    expect(longestRoute({ paths: [] })).toBe(-1);
  });

  it('takes ?route=N (1-based) when it names a route, the longest otherwise', () => {
    expect(chosenRoute(card, '1')).toBe(0);
    expect(chosenRoute(card, '3')).toBe(2);
    expect(chosenRoute(card, ['3', '1'])).toBe(2);
    for (const value of [undefined, '0', '4', '-1', 'x', '1.5', '999']) expect(chosenRoute(card, value), String(value)).toBe(1);
  });
});
