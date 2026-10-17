import { describe, expect, it } from 'vitest';

import { isUuidv7, uuidVersion, uuidv7, uuidv7FromParts, uuidv7Timestamp } from './ids';

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 ids with the 10xx variant', () => {
    for (let i = 0; i < 1000; i++) {
      const id = uuidv7();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(uuidVersion(id)).toBe(7);
      expect(isUuidv7(id)).toBe(true);
    }
  });

  it('stores the current time in the first 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it('is strictly increasing within one millisecond and across counter overflow', () => {
    const fixed = 1_800_000_000_000;
    const ids = Array.from({ length: 10_000 }, () => uuidv7(fixed));
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // 10 000 ids cannot fit in one 12-bit counter: the timestamp moved forward.
    expect(uuidv7Timestamp(ids.at(-1)!)).toBeGreaterThan(fixed);
  });

  it('never decreases when the clock goes backwards', () => {
    const a = uuidv7(1_900_000_000_000);
    const b = uuidv7(1_899_999_999_000);
    expect(b > a).toBe(true);
  });

  it('builds deterministic ids from explicit parts', () => {
    const random = new Uint8Array([0xff, 1, 2, 3, 4, 5, 6, 7]);
    const id = uuidv7FromParts(0x0189_abcd_ef01, 0xabc, random);
    expect(id).toBe('0189abcd-ef01-7abc-bf01-020304050607');
    expect(uuidv7Timestamp(id)).toBe(0x0189_abcd_ef01);
    expect(() => uuidv7FromParts(-1, 0, random)).toThrow();
    expect(() => uuidv7FromParts(0, 0x1000, random)).toThrow();
  });

  it('recognises other versions', () => {
    expect(uuidVersion('6f1c2b8e-1d2a-4b3c-8d4e-5f6a7b8c9d0e')).toBe(4);
    expect(isUuidv7('6f1c2b8e-1d2a-4b3c-8d4e-5f6a7b8c9d0e')).toBe(false);
    expect(uuidVersion('not-a-uuid')).toBeNull();
  });
});
