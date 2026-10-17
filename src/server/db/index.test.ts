import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRoleDatabase, logIdleClientError } from './index';

// Nothing connects: a pg Pool opens connections only on the first query.
const BASE = 'postgres://postgres:secret@127.0.0.1:1/wingchunroots_unit';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('role pools', () => {
  it.each(['app_rw', 'app_public_ro'] as const)('%s has exactly one idle-client error listener', async (role) => {
    const db = createRoleDatabase(role, BASE, 'role-secret');
    try {
      expect(db.$client.listenerCount('error')).toBe(1);
    } finally {
      await db.$client.end();
    }
  });

  it('survives an idle client error and logs only the role and the SQLSTATE', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = createRoleDatabase('app_rw', BASE, 'role-secret');
    try {
      const error = Object.assign(new Error(`terminating connection for ${BASE}`), { code: '57P01' });
      // Without a listener, EventEmitter would throw this error (an unhandled 'error' event).
      expect(() => db.$client.emit('error', error, {})).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]![0]);
      expect(line).toBe('db pool app_rw: idle client error 57P01');
      expect(line).not.toContain('secret');
    } finally {
      await db.$client.end();
    }
  });

  it('logs an error without a code', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    logIdleClientError('app_public_ro', new Error('Connection terminated unexpectedly'));
    expect(log).toHaveBeenCalledWith('db pool app_public_ro: idle client error');
  });
});
