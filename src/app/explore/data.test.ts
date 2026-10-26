// The list view of /explore tells "not on the record" from "the read failed" (code review of M05:
// a failed read showed "There is no public profile with this address in the record.").

import { describe, expect, it } from 'vitest';

import type { LineageGraphDto } from '@/server/dto/public';
import { ORPCError } from '@/server/rpc/server';
import { isAbsent, readFocus } from './data';

const focusId = '00000000-0000-4000-8000-000000000001';
const graph = (nodes: { id: string; slug: string }[]) => ({ nodes }) as unknown as LineageGraphDto;

describe('readFocus', () => {
  it('finds the address of the person in focus', async () => {
    expect(await readFocus(async () => graph([{ id: focusId, slug: 'demo-person' }]), focusId)).toEqual({ state: 'found', slug: 'demo-person' });
  });

  it('a person who is not on the record, hidden or asked for with a malformed id is "none"', async () => {
    expect(await readFocus(async () => graph([]), focusId)).toEqual({ state: 'none' });
    for (const code of ['NOT_FOUND', 'BAD_REQUEST']) {
      expect(
        await readFocus(async () => {
          throw new ORPCError(code);
        }, focusId),
      ).toEqual({ state: 'none' });
    }
  });

  it('a read that failed is "failed", never "none": a timeout, an internal error, the database restarting', async () => {
    const failures = [new ORPCError('INTERNAL_SERVER_ERROR'), Object.assign(new Error('canceling statement'), { code: '57014' }), new TypeError('fetch failed')];
    for (const error of failures) {
      const read = await readFocus(async () => {
        throw error;
      }, focusId);
      expect(read).toEqual({ state: 'failed', error });
      expect(isAbsent(error)).toBe(false);
    }
  });
});
