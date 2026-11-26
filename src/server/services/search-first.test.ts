import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheTag: () => undefined, cacheLife: () => undefined, revalidateTag: () => undefined, updateTag: () => undefined }));

import { firstGroup } from './search';

type Answer = Parameters<typeof firstGroup>[1];
const none: Answer = { people: [], schools: [], events: [], organizations: [], lineages: [] };
const event = (title: string) => ({ id: '0190a5c0-0000-7000-8000-000000000001', slug: 'demo-e', title, startsAt: '2027-03-13T09:00:00Z', timezone: 'Europe/Berlin', city: 'Berlin', countryCode: 'DE', online: false });
const organization = (name: string) => ({ id: '0190a5c0-0000-7000-8000-000000000002', slug: 'demo-o', name, kind: 'federation' as const, kindLabel: 'Federation', countryCode: 'DE' });

describe('firstGroup (role replay P2-5)', () => {
  it('puts the exact name before a longer one that the words also cover', () => {
    const answer = { ...none, events: [event('Demo Federation North summer camp')], organizations: [organization('Demo Federation North')] } as unknown as Answer;
    expect(firstGroup('federation north', answer)).toBe('organizations');
  });

  it('keeps the group order on a tie, and needs two words', () => {
    const answer = { ...none, events: [event('Demo North Camp')], organizations: [organization('Demo North Club')] } as unknown as Answer;
    expect(firstGroup('demo north', answer)).toBe('events');
    expect(firstGroup('north', answer)).toBeNull();
  });
});
