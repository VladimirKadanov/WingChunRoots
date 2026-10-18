// The minimum answer time of the endpoints that could tell whether an address has an account
// (src/server/auth/answer-floor.ts; fix round 3, security-2).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { answerFloorMs, waitForFloor } from './answer-floor';

afterEach(() => {
  vi.useRealTimers();
});

describe('answerFloorMs', () => {
  it('holds an accepted sign-up and reset request and a refused sign-in', () => {
    expect(answerFloorMs('/sign-up/email', 200)).toBeGreaterThanOrEqual(500);
    expect(answerFloorMs('/request-password-reset', 200)).toBeGreaterThanOrEqual(500);
    expect(answerFloorMs('/sign-in/email', 401)).toBeGreaterThanOrEqual(500);
  });

  it('answers at once where the time tells nothing about the address', () => {
    // A successful sign-in (the caller knows the password), refusals that do not depend on the
    // address (a missing tick, a malformed body, a rate limit), and every other endpoint.
    expect(answerFloorMs('/sign-in/email', 200)).toBe(0);
    expect(answerFloorMs('/sign-in/email', 429)).toBe(0);
    expect(answerFloorMs('/sign-up/email', 400)).toBe(0);
    expect(answerFloorMs('/request-password-reset', 429)).toBe(0);
    expect(answerFloorMs('/get-session', 200)).toBe(0);
  });
});

describe('waitForFloor', () => {
  it('waits for what is left of the floor, and not at all once it has passed', async () => {
    vi.useFakeTimers();
    let now = 1000;
    let done = false;
    const waiting = waitForFloor(500, 1000, () => (now += 120)).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(379);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);

    const timer = vi.spyOn(globalThis, 'setTimeout');
    await waitForFloor(500, 0, () => 900);
    expect(timer).not.toHaveBeenCalled();
  });
});
