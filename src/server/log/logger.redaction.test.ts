// pino removes e-mail addresses, names, IP addresses and coordinates from every log line (plan §6.4,
// CLAUDE.md §6; milestone M12, Done when 2). All values are fictional (D20): example.test addresses,
// documentation and benchmarking IP ranges, demo names.

import { describe, expect, it } from 'vitest';

import { configureLogger, createLogger, logLevel, reportError, requestLogger, restoreLogger, setErrorProvider, type ErrorReport } from './index';
import { isSensitiveKey, redactText } from './redact';

/** A destination that keeps the lines pino writes. */
function capture() {
  const lines: string[] = [];
  return {
    lines,
    destination: { write: (line: string) => void lines.push(line) },
    parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const EMAIL = 'demo-person@example.test';
const NAME = 'Demo Lam Siu';
const IPV4 = '198.18.0.7';
const IPV6 = '2001:db8::17';
const LAT = '42.6977';
const LNG = '23.3219';

/** None of the fictional personal values appears anywhere in the written lines. */
function expectClean(lines: string[]) {
  const all = lines.join('\n');
  for (const value of [EMAIL, NAME, IPV4, IPV6, LAT, LNG, 'Demo', 'Lam Siu']) expect(all, value).not.toContain(value);
  expect(all).not.toContain('@');
}

describe('logger redaction (logger.redaction.test.ts)', () => {
  it('removes the e-mail address, name, IP address and coordinates of logged fields, at any depth', () => {
    const out = capture();
    const log = createLogger({ destination: out.destination });
    log.info(
      {
        email: EMAIL,
        toEmail: EMAIL,
        user: { displayName: NAME, name: NAME, firstName: 'Demo', lastName: 'Lam Siu' },
        ip: IPV4,
        clientAddress: IPV6,
        location: { lat: Number(LAT), lng: Number(LNG) },
        school: { latitude: Number(LAT), longitude: Number(LNG), coordinates: [Number(LNG), Number(LAT)] },
        people: [{ person: { names: [NAME] } }, { contact: { email: EMAIL } }],
        headers: { 'x-forwarded-for': IPV4, cookie: 'wcr.session=secret' },
        password: 'demo-password',
        sessionToken: 'demo-token',
        queue: 'email.send',
        count: 3,
      },
      'a fictional event',
    );
    expectClean(out.lines);
    const [line] = out.parsed();
    expect(line).toMatchObject({
      level: 'info',
      service: 'web',
      msg: 'a fictional event',
      email: '[redacted]',
      toEmail: '[redacted]',
      user: { displayName: '[redacted]', name: '[redacted]', firstName: '[redacted]', lastName: '[redacted]' },
      ip: '[redacted]',
      clientAddress: '[redacted]',
      location: '[redacted]',
      school: { latitude: '[redacted]', longitude: '[redacted]', coordinates: '[redacted]' },
      people: [{ person: { names: '[redacted]' } }, { contact: { email: '[redacted]' } }],
      headers: '[redacted]',
      password: '[redacted]',
      sessionToken: '[redacted]',
      // What is not personal stays.
      queue: 'email.send',
      count: 3,
    });
    expect(typeof line?.time).toBe('string');
    expect(line).not.toHaveProperty('pid');
    expect(line).not.toHaveProperty('hostname');
  });

  it('removes e-mail addresses, IP addresses and coordinates from messages and string values', () => {
    const out = capture();
    const log = createLogger({ destination: out.destination });
    log.warn(`sign-in for ${EMAIL} from ${IPV4} and ${IPV6} near ${LAT}, ${LNG}`);
    log.info({ detail: `SRID=4326;POINT(${LNG} ${LAT})`, note: `lat=${LAT} lng: ${LNG}` }, 'school moved');
    log.error('query failed for %s at %s', EMAIL, IPV4);
    expectClean(out.lines);
    const [first, second, third] = out.parsed();
    expect(first?.msg).toBe('sign-in for <address> from <ip> and <ip> near <coordinates>');
    expect(second).toMatchObject({ detail: 'SRID=4326;POINT(<coordinates>)', note: 'lat=<coordinates> lng: <coordinates>' });
    expect(third?.msg).toBe('query failed for <address> at <ip>');
  });

  it('keeps only the type and code of an error, never its message or stack (they can quote SQL parameters)', () => {
    const out = capture();
    const log = createLogger({ destination: out.destination });
    const error = Object.assign(new Error(`duplicate key value (email)=(${EMAIL}) for ${NAME}`), { code: '23505' });
    log.error({ err: error }, 'insert failed');
    log.error(error);
    expectClean(out.lines);
    const [first, second] = out.parsed();
    expect(first?.err).toEqual({ type: 'Error', code: '23505' });
    expect(JSON.stringify(second)).not.toContain('duplicate key');
    expect(out.lines.join('\n')).not.toContain('stack');
  });

  it('a request logger carries the request id; bindings are scrubbed like fields', () => {
    const out = capture();
    const previous = configureLogger({ destination: out.destination });
    try {
      requestLogger('0190a5b2-demo-request').child({ email: EMAIL, ip: IPV4 }).info({ displayName: NAME }, 'request handled');
    } finally {
      restoreLogger(previous);
    }
    expectClean(out.lines);
    expect(out.parsed()[0]).toMatchObject({ requestId: '0190a5b2-demo-request', email: '[redacted]', ip: '[redacted]', displayName: '[redacted]' });
  });

  it('reportError logs the error type with its context and hands the scrubbed report to the provider, which is empty by default', async () => {
    const out = capture();
    const log = createLogger({ service: 'worker', destination: out.destination });
    // The empty provider of Phase 1 (plan §3.3): nothing leaves the process, and nothing throws.
    await expect(reportError(new TypeError(`bad input from ${EMAIL}`), { requestId: 'req-7', where: 'render' }, log)).resolves.toBeUndefined();
    const reports: ErrorReport[] = [];
    const previous = setErrorProvider((_error, report) => void reports.push(report));
    try {
      await reportError(Object.assign(new Error(NAME), { code: 'ECONNREFUSED' }), { where: 'healthz', ip: IPV4 }, log);
      // A provider that fails does not turn into an error of the caller.
      setErrorProvider(() => {
        throw new Error('provider down');
      });
      await expect(reportError(new Error('x'), {}, log)).resolves.toBeUndefined();
    } finally {
      setErrorProvider(previous);
    }
    expectClean(out.lines);
    const [first, second] = out.parsed();
    expect(first).toMatchObject({ level: 'error', service: 'worker', msg: 'error reported', requestId: 'req-7', where: 'render', error: { type: 'TypeError' } });
    expect(second).toMatchObject({ where: 'healthz', ip: '[redacted]', error: { type: 'Error', code: 'ECONNREFUSED' } });
    expect(reports).toEqual([{ where: 'healthz', ip: '[redacted]', error: { type: 'Error', code: 'ECONNREFUSED' } }]);
  });

  it('recognises the keys and text it must remove, and leaves ordinary text alone', () => {
    for (const key of ['email', 'E-Mail', 'to_email', 'name', 'display_name', 'ip', 'X-Forwarded-For', 'lat', 'Longitude', 'coordinates', 'privateLocation', 'apiKey']) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ['queue', 'requestId', 'count', 'status', 'procedure', 'code', 'type']) expect(isSensitiveKey(key), key).toBe(false);
    expect(redactText('rpc grants.create failed: DrizzleQueryError (postgres 57014) request 0190a5b2')).toBe(
      'rpc grants.create failed: DrizzleQueryError (postgres 57014) request 0190a5b2',
    );
    expect(redactText('worker: ready (mail transport: smtp)')).toBe('worker: ready (mail transport: smtp)');
    expect(redactText('took 12.5 s, 3 jobs')).toBe('took 12.5 s, 3 jobs');
  });

  it('reads LOG_LEVEL, and falls back to info for anything else', () => {
    expect(logLevel({ LOG_LEVEL: 'debug' })).toBe('debug');
    expect(logLevel({ LOG_LEVEL: ' WARN ' })).toBe('warn');
    expect(logLevel({ LOG_LEVEL: 'verbose' })).toBe('info');
    expect(logLevel({})).toBe('info');
    const out = capture();
    createLogger({ level: 'warn', destination: out.destination }).info('not written');
    expect(out.lines).toEqual([]);
  });
});
