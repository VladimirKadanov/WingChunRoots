// scripts/trace-summary.mjs: the job-log summary of a failed test's Playwright trace, on traces in
// the format of Playwright 1.64.1 (trace version 10: test.trace, <n>-trace.trace, <n>-trace.network),
// and that it never prints what the trace holds besides the summary (bodies, headers, cookies,
// query strings, typed values, snapshots, secrets).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  TRACE_VERSION,
  allocate,
  errorContextExcerpt,
  errorHeadline,
  makeScrubber,
  parseTrace,
  pick,
  readTraceZip,
  renderSummary,
  safeApiTitle,
  summarize,
  tokenLike,
  urlPath,
  zipEntries,
  zipRead,
} from './trace-summary.mjs';

const PASSWORD = 'wcr-0123456789abcdef01';
const SESSION_TOKEN = 'DVgTPQuxHMAjynlHVXy5OiiBuCGIQ5Pr';
const ENV = {
  E2E_PASSWORD: PASSWORD,
  E2E_TOTP_SECRET: 'totp-secret-0123456789',
  BETTER_AUTH_SECRET: 'auth-secret-abcdef0123456789',
  TEST_DATABASE_URL: 'postgres://postgres:db-pass-0451@127.0.0.1:5432/wcr',
};
/** Every value below must stay out of the summary. */
const NEVER_PRINTED = [
  PASSWORD,
  SESSION_TOKEN,
  '123456',
  'db-pass-0451',
  'QUERY-VALUE',
  'HIDDEN-ARG',
  'FRAGMENT-VALUE',
  'COOKIE-VALUE',
  'SET-COOKIE-VALUE',
  'HEADER-VALUE',
  'POST-BODY-VALUE',
  'RESPONSE-BODY-VALUE',
  'DOM-SNAPSHOT-VALUE',
  'ARIA-SNAPSHOT-VALUE',
  'STDOUT-VALUE',
  'CONSOLE-ARG-VALUE',
  'ACTION-LOG-VALUE',
  'a plain log line',
  'AbCdEf0123456789XyZabc',
];

// --- a minimal zip writer (stored or deflated; ZIP64 on request) ---------------------------

function zip(files: Record<string, string>, { deflate = true, zip64 = false } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const body = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const extra = Buffer.alloc(zip64 ? 28 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(body.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(45, 4);
    entry.writeUInt16LE(45, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(zip64 ? 0xffffffff : body.length, 20);
    entry.writeUInt32LE(zip64 ? 0xffffffff : data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(extra.length, 30);
    entry.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    parts.push(local, nameBytes, body);
    central.push(entry, nameBytes, extra);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const count = Object.keys(files).length;
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...parts, directory, ...tail, end]);
}

// --- a trace in the format of Playwright 1.64.1 ----------------------------------------------

const lines = (events: object[]) => events.map((e) => JSON.stringify(e)).join('\n');
const ORIGIN = 'http://127.0.0.1:3100';

function header(name: string, value: string) {
  return { name, value };
}

function resource(
  url: string,
  {
    method = 'GET',
    status = 200,
    type = 'fetch' as string | null,
    at = 1200,
    headers = [] as { name: string; value: string }[],
    failure = undefined as string | undefined,
    api = false,
  } = {},
) {
  return {
    type: 'resource-snapshot',
    snapshot: {
      pageref: api ? undefined : 'page@1',
      startedDateTime: '2026-10-26T01:00:04.505Z',
      time: 42,
      request: {
        method,
        url,
        headers: [header('cookie', 'session=COOKIE-VALUE'), header('x-custom', 'HEADER-VALUE'), ...headers],
        cookies: [{ name: 'session', value: 'COOKIE-VALUE' }],
        queryString: [{ name: 'q', value: 'QUERY-VALUE' }],
        postData: method === 'POST' ? { mimeType: 'text/plain', text: 'POST-BODY-VALUE' } : undefined,
      },
      response: {
        status,
        statusText: '',
        headers: [header('set-cookie', 'session=SET-COOKIE-VALUE')],
        cookies: [{ name: 'session', value: 'SET-COOKIE-VALUE' }],
        content: { mimeType: 'text/html', text: 'RESPONSE-BODY-VALUE' },
        _failureText: failure,
      },
      _monotonicTime: at,
      _resourceType: type,
      ...(api ? { _apiRequestRef: 'request@1' } : {}),
    },
  };
}

function traceFiles({ browserName = 'webkit', project = 'mobile-webkit', title = 'm07-search.spec.ts:12 › Search › finds a person' } = {}) {
  const testTrace = lines([
    { version: 10, type: 'context-options', origin: 'testRunner', browserName: '', options: {}, platform: 'linux', wallTime: 1_000_000, monotonicTime: 1000, sdkLanguage: 'javascript', testTimeout: 30000, annotations: [] },
    { type: 'before', callId: 'f1', startTime: 1001, class: 'Test', method: 'fixture', title: 'Fixture "viewport"', params: {}, stack: [{ file: `project#${project}`, line: 1, column: 1 }], group: 'configuration' },
    { type: 'after', callId: 'f1', endTime: 1002 },
    { type: 'before', callId: 'c1', startTime: 1100, class: 'Test', method: 'pw:api', title: 'Navigate', subtitle: '127.0.0.1:3100/people/demo-root-a?q=QUERY-VALUE', params: { url: `${ORIGIN}/people/demo-root-a?q=QUERY-VALUE#FRAGMENT-VALUE` }, stack: [] },
    { type: 'after', callId: 'c1', endTime: 1300 },
    { type: 'before', callId: 'c2', startTime: 1310, class: 'Test', method: 'pw:api', title: `Fill "${PASSWORD}"`, subtitle: "getByLabel('Password')", params: { locator: "getByLabel('Password')", value: PASSWORD }, stack: [] },
    { type: 'after', callId: 'c2', endTime: 1320 },
    { type: 'before', callId: 'c3', startTime: 1321, class: 'Test', method: 'pw:api', title: 'Press "Enter"', subtitle: "getByLabel('Password')", params: { key: 'Enter' }, stack: [] },
    { type: 'after', callId: 'c3', endTime: 1330 },
    { type: 'before', callId: 'c4', startTime: 1331, class: 'Test', method: 'pw:api', title: 'Type "123456"', subtitle: "getByLabel('Code')", params: { text: '123456' }, stack: [] },
    { type: 'after', callId: 'c4', endTime: 1340 },
    { type: 'before', callId: 'c5', startTime: 1341, class: 'Test', method: 'pw:api', title: 'POST', subtitle: '127.0.0.1:3100/api/auth/sign-in/email', params: { url: `${ORIGIN}/api/auth/sign-in/email`, method: 'POST' }, stack: [] },
    { type: 'after', callId: 'c5', endTime: 1350 },
    // A helper's expect with a response body as its message (e2e/helpers/auth.ts).
    { type: 'before', callId: 'm1', startTime: 1351, class: 'Test', method: 'expect', title: `{"token":"${SESSION_TOKEN}","user":{"email":"demo-root-a@example.test"}}`, params: { expected: '200' }, stack: [] },
    { type: 'after', callId: 'm1', endTime: 1352 },
    { type: 'before', callId: 'h1', startTime: 1360, class: 'Test', method: 'hook', title: 'beforeEach hook', params: {}, stack: [] },
    { type: 'before', callId: 'e1', parentId: 'h1', startTime: 1400, class: 'Test', method: 'expect', title: 'Expect "toBeVisible"', subtitle: "getByRole('dialog')", params: { locator: "getByRole('dialog')" }, stack: [] },
    {
      type: 'after',
      callId: 'e1',
      endTime: 6400,
      error: { name: '', message: '\u001b[2mError: expect(locator).toBeVisible() failed\u001b[22m\n\nLocator: getByRole(\'dialog\')\nCall log:\n  - fill("ACTION-LOG-VALUE")', stack: 'Error: …' },
    },
    { type: 'after', callId: 'h1', endTime: 6401, error: { message: 'Error: expect(locator).toBeVisible() failed' } },
    { type: 'before', callId: 'a1', startTime: 6402, class: 'Test', method: 'test.attach', title: 'Attach "error-context"', params: {}, stack: [] },
    { type: 'after', callId: 'a1', endTime: 6403, attachments: [{ name: 'error-context', contentType: 'text/markdown', file: 'attachments/x' }] },
    { type: 'error', message: 'Error: expect(locator).toBeVisible() failed\n\nCall log:\n  - waiting', stack: [] },
    { type: 'stdout', timestamp: 6500, text: 'STDOUT-VALUE' },
  ]);
  const libraryTrace = lines([
    { version: 10, type: 'context-options', origin: 'library', browserName, playwrightVersion: '1.64.1', options: { viewport: { width: 393, height: 659 }, isMobile: true, hasTouch: true }, platform: 'linux', wallTime: 1_000_005, monotonicTime: 1005, sdkLanguage: 'javascript', title },
    { type: 'event', time: 1050, class: 'BrowserContext', method: 'page', params: { pageId: 'page@1' } },
    { type: 'before', callId: 'c2', startTime: 1311, class: 'Frame', method: 'fill', params: { selector: 'internal:label="Password"i', value: PASSWORD } },
    { type: 'log', callId: 'c2', time: 1312, message: `  fill("ACTION-LOG-VALUE")` },
    { type: 'after', callId: 'c2', endTime: 1319 },
    { type: 'console', messageType: 'log', text: 'a plain log line', args: [{ preview: 'CONSOLE-ARG-VALUE', value: 'CONSOLE-ARG-VALUE' }], location: { url: `${ORIGIN}/`, lineNumber: 0, columnNumber: 0 }, time: 1150, pageId: 'page@1' },
    {
      type: 'console',
      messageType: 'error',
      text: 'Minified React error #418; visit https://react.dev/errors/418?args[]=HIDDEN-ARG for the full message',
      args: [{ preview: 'CONSOLE-ARG-VALUE', value: 'CONSOLE-ARG-VALUE' }],
      location: { url: `${ORIGIN}/_next/static/chunks/app.js?v=QUERY-VALUE`, lineNumber: 0, columnNumber: 1233 },
      time: 1200,
      pageId: 'page@1',
    },
    { type: 'console', messageType: 'warning', text: `set-cookie: session=COOKIE-VALUE; sign-in for ${PASSWORD} with Bearer HEADER-VALUE`, args: [], location: { url: `${ORIGIN}/`, lineNumber: 2, columnNumber: 4 }, time: 1210, pageId: 'page@1' },
    { type: 'console', messageType: 'warning', text: `set-cookie: session=COOKIE-VALUE; sign-in for ${PASSWORD} with Bearer HEADER-VALUE`, args: [], location: { url: `${ORIGIN}/`, lineNumber: 2, columnNumber: 4 }, time: 1220, pageId: 'page@1' },
    { type: 'console', messageType: 'debug', text: 'A tree hydrated but some attributes of the server rendered HTML did not match', args: [], location: { url: `${ORIGIN}/` }, time: 1230, pageId: 'page@1' },
    {
      type: 'event',
      time: 1250,
      class: 'BrowserContext',
      method: 'pageError',
      params: {
        error: {
          error: {
            name: 'TypeError',
            message: "undefined is not an object (evaluating 'a.b')",
            stack: `render@${ORIGIN}/_next/static/chunks/page.js:1:200\nglobal code@${ORIGIN}/people/demo-x?token=QUERY-VALUE:3:4`,
          },
        },
        location: { url: `${ORIGIN}/people/demo-x`, line: 3, column: 4 },
      },
      pageId: 'page@1',
    },
    { type: 'frame-snapshot', snapshot: { callId: 'c2', html: ['DOM-SNAPSHOT-VALUE'], pageId: 'page@1' } },
  ]);
  const libraryNetwork = lines([
    resource(`${ORIGIN}/people/demo-root-a?q=QUERY-VALUE`, { type: 'document', at: 1105 }),
    resource(`${ORIGIN}/people/demo-root-a?_rsc=QUERY-VALUE`, { method: 'POST', at: 1360, headers: [header('next-action', 'HEADER-VALUE')] }),
    resource(`${ORIGIN}/search?_rsc=QUERY-VALUE`, { at: 1370, headers: [header('rsc', '1')] }),
    resource(`${ORIGIN}/plans?_rsc=QUERY-VALUE`, { at: 1371, headers: [header('rsc', '1'), header('next-router-prefetch', '1')], failure: 'net::ERR_ABORTED' }),
    resource(`${ORIGIN}/_next/static/chunks/a.js`, { type: 'script', at: 1110 }),
    resource(`${ORIGIN}/_next/static/chunks/b.js`, { type: 'script', status: -1, at: 1115, failure: 'net::ERR_ABORTED' }),
    resource(`${ORIGIN}/missing.png`, { type: 'image', status: 404, at: 1120 }),
    resource(`${ORIGIN}/api/auth/reset-password/AbCdEf0123456789XyZabc?callbackURL=QUERY-VALUE`, { at: 1380 }),
    resource(`https://tiles.example.test/7/1/2.png`, { type: 'image', status: 503, at: 1390 }),
  ]);
  const apiNetwork = lines([resource(`${ORIGIN}/api/auth/sign-in/email`, { method: 'POST', type: null, at: 1342, api: true })]);
  return {
    'test.trace': testTrace,
    '0-trace.trace': lines([{ version: 10, type: 'context-options', origin: 'library', browserName: '', options: {}, platform: 'linux', wallTime: 1_000_002, monotonicTime: 1002, sdkLanguage: 'javascript', title }]),
    '0-trace.network': apiNetwork,
    '1-trace.trace': libraryTrace,
    '1-trace.network': libraryNetwork,
    '1-trace.stacks': '{"files":[],"stacks":[]}',
    'resources/page.html': 'RESPONSE-BODY-VALUE',
  };
}

const ERROR_CONTEXT = [
  '# Instructions',
  '',
  '# Test info',
  '',
  '- Name: m07-search.spec.ts >> Search >> finds a person',
  '',
  '# Error details',
  '',
  '```',
  'Error: expect(locator).toBeVisible() failed',
  '```',
  '',
  '# Page snapshot',
  '',
  '```yaml',
  '- textbox "Password": ARIA-SNAPSHOT-VALUE',
  '```',
  '',
  '# Test source',
  '',
  '```ts',
  ...Array.from({ length: 30 }, (_, i) => `  ${String(i + 1).padEnd(2)} | // line ${i + 1}`).map((l, i) =>
    i === 23 ? "> 24 |   await expect(page.getByRole('dialog')).toBeVisible();" : l,
  ),
  '```',
].join('\n');
// The caret line that Playwright puts right after the failing line.
const ERROR_CONTEXT_WITH_CARET = ERROR_CONTEXT.replace(
  "> 24 |   await expect(page.getByRole('dialog')).toBeVisible();",
  "> 24 |   await expect(page.getByRole('dialog')).toBeVisible();\n     |                                          ^ Error: expect(locator).toBeVisible() failed",
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'trace-summary-'));
  dirs.push(dir);
  return dir;
}
const filesOf = (record: Record<string, string>) => new Map(Object.entries(record));

describe('zip', () => {
  it.each([
    ['deflated', { deflate: true }],
    ['stored', { deflate: false }],
    ['ZIP64', { deflate: true, zip64: true }],
  ])('reads %s entries', (_label, options) => {
    const buf = zip({ 'test.trace': 'first\nsecond', 'resources/a.bin': 'x'.repeat(5000) }, options);
    const entries = zipEntries(buf);
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['test.trace', 'resources/a.bin']);
    expect(zipRead(buf, entries[0]).toString()).toBe('first\nsecond');
    expect(zipRead(buf, entries[1]).toString()).toBe('x'.repeat(5000));
  });

  it('takes only the trace and network files, never resources', () => {
    const files = readTraceZip(zip(traceFiles()));
    expect([...files.keys()].sort()).toEqual(['0-trace.network', '0-trace.trace', '1-trace.network', '1-trace.trace', 'test.trace']);
  });

  it('refuses a file that is not a zip', () => {
    expect(() => zipEntries(Buffer.from('not a zip at all, just some text'))).toThrow(/not a zip/);
  });
});

describe('scrubbing', () => {
  const scrub = makeScrubber(ENV);

  it('removes the secret settings, URL credentials, auth values, cookie lines, tokens and query strings', () => {
    expect(scrub(`password ${PASSWORD} and ${ENV.BETTER_AUTH_SECRET}`)).toBe('password *** and ***');
    expect(scrub('postgres://u:db-pass-0451@h/db and postgres://a:other-pass@h/db')).toBe('postgres://u:***@h/db and postgres://a:***@h/db');
    expect(scrub('Authorization: Bearer abc.def')).toBe('Authorization: ***');
    expect(scrub('sent Bearer abc.def-ghi')).toBe('sent Bearer ***');
    expect(scrub('cookie: a=1; b=2')).toBe('cookie: ***');
    expect(scrub('see https://h.test/a/b?token=x&y=1#frag and /c?d=e and ?q=Wong')).toBe('see https://h.test/a/b?… and /c?… and ?…');
    expect(scrub('then token=abc123&next')).toBe('then token=***&next');
    expect(scrub(`{"token":"${SESSION_TOKEN}","backupCodes":["a","b"],"name":"Demo"}`)).toBe('{"token":"***","backupCodes":"***","name":"Demo"}');
    expect(scrub('\u001b[31mred\u001b[39m')).toBe('red');
  });

  it('prints URL paths only: no query string, no fragment, no token-like segment', () => {
    expect(urlPath(`${ORIGIN}/people/demo-root-a?q=1#x`, ORIGIN)).toBe('/people/demo-root-a?…');
    expect(urlPath(`${ORIGIN}/people/demo-root-a#x`, ORIGIN)).toBe('/people/demo-root-a');
    expect(urlPath('https://tiles.example.test/7/1/2.png', ORIGIN)).toBe('https://tiles.example.test/7/1/2.png');
    expect(urlPath(`${ORIGIN}/search/%E8%91%89%E5%95%8F`, ORIGIN)).toBe('/search/葉問');
    expect(urlPath(`${ORIGIN}/api/auth/reset-password/AbCdEf0123456789XyZabc`, ORIGIN)).toBe('/api/auth/reset-password/:token');
    expect(urlPath('data:text/plain;base64,SECRET', ORIGIN)).toBe('data:…');
    expect(urlPath('/relative?x=1', ORIGIN)).toBe('/relative?…');
    expect(tokenLike('0199d0c4-5e3a-7b2c-9f1e-1234567890ab')).toBe(false);
    expect(tokenLike('demo-wong-shun-leung-2')).toBe(false);
    expect(tokenLike('3f2a9c0d4e5b6a7f8e9d0c1b2a3f4e5d')).toBe(true);
    expect(tokenLike('chunks-abc')).toBe(false);
  });

  it('keeps key names, attribute names and expect expressions in action titles, and nothing typed', () => {
    expect(safeApiTitle(`Fill "${PASSWORD}"`)).toBe('Fill "…"');
    expect(safeApiTitle('Type "123456"')).toBe('Type "…"');
    expect(safeApiTitle('Insert "a "quoted" text"')).toBe('Insert "…"');
    expect(safeApiTitle('Press "Enter"')).toBe('Press "Enter"');
    expect(safeApiTitle('Press "ControlOrMeta+k"')).toBe('Press "ControlOrMeta+k"');
    expect(safeApiTitle('Press "/"')).toBe('Press "/"');
    expect(safeApiTitle('Press "7"')).toBe('Press "…"');
    expect(safeApiTitle('Press "Secret123"')).toBe('Press "…"');
    expect(safeApiTitle('Get attribute "aria-expanded"')).toBe('Get attribute "aria-expanded"');
    expect(safeApiTitle('Dispatch "click"')).toBe('Dispatch "click"');
    expect(safeApiTitle('Click')).toBe('Click');
  });

  it('never takes a custom expect message for the headline of an error', () => {
    const body = `{"token":"${SESSION_TOKEN}"}`;
    expect(errorHeadline(`Error: ${body}\n\nexpect(received).toBe(expected) // Object.is equality`, [body])).toBe(
      'expect(received).toBe(expected) // Object.is equality',
    );
    expect(errorHeadline(`Error: ${body}`, [body])).toBe('(not shown: a custom expect message)');
    expect(errorHeadline('\u001b[2mError: page.goto: Timeout 15000ms exceeded.\u001b[22m\nCall log:')).toBe('Error: page.goto: Timeout 15000ms exceeded.');
  });
});

describe('parseTrace and renderSummary', () => {
  const scrub = makeScrubber(ENV);
  const model = parseTrace(filesOf(traceFiles()));
  const summary = renderSummary(model, { scrub, tracePath: 'test-results/artifacts/x-mobile-webkit/trace.zip', excerpt: errorContextExcerpt(ERROR_CONTEXT_WITH_CARET, scrub) });
  const text = summary.join('\n');

  it('names the test, its project and its browser', () => {
    expect(summary[0]).toBe('=== [mobile-webkit] m07-search.spec.ts:12 › Search › finds a person');
    expect(summary[1]).toBe('    trace: test-results/artifacts/x-mobile-webkit/trace.zip');
    expect(summary[2]).toBe('    webkit 393x659 mobile touch, Playwright 1.64.1, test timeout 30.00s, 5.40s recorded');
    expect(summary[3]).toBe('    test error: Error: expect(locator).toBeVisible() failed');
    expect(model.version).toBe(TRACE_VERSION);
  });

  it('prints page errors with their stack, and console errors, warnings and hydration messages once each', () => {
    expect(text).toContain("  +0.250s TypeError: undefined is not an object (evaluating 'a.b')\n      render@/_next/static/chunks/page.js:1:200\n      global code@/people/demo-x?…");
    expect(text).toContain('  +0.200s error   [hydration] Minified React error #418; visit https://react.dev/errors/418?… for the full message (at /_next/static/chunks/app.js?…:1:1234)');
    expect(text).toContain('  +0.210s warning set-cookie: *** (at /:3:5) (×2)');
    expect(text).toContain('  +0.230s debug   [hydration] A tree hydrated but some attributes of the server rendered HTML did not match (at /:1:1)');
    expect(text).toContain('console errors and warnings (3 distinct)');
  });

  it('prints the action timeline with start, duration, nesting and errors, without configuration fixtures', () => {
    expect(text).toContain('  +0.100s   200ms  api     Navigate /people/demo-root-a?…');
    expect(text).toContain(`  +0.310s    10ms  api     Fill "…" getByLabel('Password')`);
    expect(text).toContain(`  +0.321s     9ms  api     Press "Enter" getByLabel('Password')`);
    expect(text).toContain(`  +0.331s     9ms  api     Type "…" getByLabel('Code')`);
    expect(text).toContain('  +0.341s     9ms  api     POST /api/auth/sign-in/email');
    expect(text).toContain('  +0.351s     1ms  expect  Expect (custom message not shown)');
    expect(text).toContain(`  +0.400s   5.00s  expect    Expect "toBeVisible" getByRole('dialog')\n                              error: Error: expect(locator).toBeVisible() failed`);
    expect(text).not.toContain('Fixture "viewport"');
    expect(text).not.toContain('Attach "error-context"');
  });

  it('prints documents, fetches, Server Actions, RSC and API requests, and every failure, by path', () => {
    expect(text).toContain('  +0.105s GET    200     42ms  document  /people/demo-root-a?…');
    expect(text).toContain('  +0.115s GET    ERR     42ms  script    /_next/static/chunks/b.js  (net::ERR_ABORTED)');
    expect(text).toContain('  +0.120s GET    404     42ms  image     /missing.png');
    expect(text).toContain('  +0.342s POST   200     42ms  api       /api/auth/sign-in/email');
    expect(text).toContain('  +0.360s POST   200     42ms  action    /people/demo-root-a?…');
    expect(text).toContain('  +0.370s GET    200     42ms  rsc       /search?…');
    expect(text).toContain('  +0.380s GET    200     42ms  fetch     /api/auth/reset-password/:token?…');
    expect(text).toContain('  +0.390s GET    503     42ms  image     https://tiles.example.test/7/1/2.png');
    expect(text).toContain('not listed, none with an error status: 1 script, 1 prefetch');
  });

  it('prints the failing line of the test source from error-context.md, never its page snapshot', () => {
    const excerpt = errorContextExcerpt(ERROR_CONTEXT_WITH_CARET);
    expect(excerpt).toHaveLength(8);
    expect(excerpt[0]).toBe('  18 | // line 18');
    expect(excerpt[6]).toBe("> 24 |   await expect(page.getByRole('dialog')).toBeVisible();");
    expect(excerpt[7]).toContain('^ Error: expect(locator).toBeVisible() failed');
    expect(errorContextExcerpt('# Page snapshot\n\n```yaml\n- textbox "Password": ARIA-SNAPSHOT-VALUE\n```')).toEqual([]);
    expect(text).toContain("  > 24 |   await expect(page.getByRole('dialog')).toBeVisible();");
  });

  it('never prints bodies, headers, cookies, query strings, typed values, logs, snapshots or secrets', () => {
    for (const value of NEVER_PRINTED) expect(text, value).not.toContain(value);
  });

  it('stays within its line cap and keeps the failed steps', () => {
    const short = renderSummary(model, { scrub, maxLines: 24 });
    expect(short.length).toBeLessThanOrEqual(24);
    expect(short.join('\n')).toContain('error: Error: expect(locator).toBeVisible() failed');
  });
});

describe('pick and allocate', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ lines: [`item ${i}`], important: i === 1 }));

  it('keeps the important items, then the latest or the earliest, in order, with a note', () => {
    expect(pick(items, 4, 'last', 'steps')).toEqual(['  … 7 of 10 steps not shown (kept: errors first, then the latest)', 'item 1', 'item 8', 'item 9']);
    expect(pick(items, 4, 'first', 'messages')).toEqual(['item 0', 'item 1', 'item 2', '  … 7 of 10 messages not shown (kept: errors first, then the earliest)']);
    expect(pick(items, 20, 'last', 'steps')).toHaveLength(10);
  });

  it('shares lines by weight and gives what one section does not need to the others', () => {
    expect(allocate([5, 100, 100], [1, 1, 2], 100)).toEqual([5, 32, 63]);
    expect(allocate([5, 5], [1, 1], 100)).toEqual([5, 5]);
  });
});

describe('summarize', () => {
  it('finds every trace.zip, puts WebKit first and reads error-context.md next to it', () => {
    const root = tempDir();
    for (const [folder, browserName, project] of [
      ['a-desktop-chromium', 'chromium', 'desktop-chromium'],
      ['b-mobile-webkit', 'webkit', 'mobile-webkit'],
    ] as const) {
      mkdirSync(path.join(root, 'artifacts', folder), { recursive: true });
      writeFileSync(path.join(root, 'artifacts', folder, 'trace.zip'), zip(traceFiles({ browserName, project, title: `${folder}.spec.ts:1 › t` })));
      writeFileSync(path.join(root, 'artifacts', folder, 'error-context.md'), ERROR_CONTEXT_WITH_CARET);
    }
    const out = summarize([root], { env: ENV, cwd: root }).join('\n');
    expect(out.indexOf('=== [mobile-webkit]')).toBeGreaterThan(0);
    expect(out.indexOf('=== [mobile-webkit]')).toBeLessThan(out.indexOf('=== [desktop-chromium]'));
    expect(out).toContain('    trace: artifacts/b-mobile-webkit/trace.zip');
    expect(out).toContain('trace-summary: 2 trace(s) summarized.');
    for (const value of NEVER_PRINTED) expect(out, value).not.toContain(value);
  });

  it('stops at the total cap and says how many traces it left out', () => {
    const root = tempDir();
    for (const n of [1, 2, 3, 4]) {
      mkdirSync(path.join(root, `t${n}`));
      writeFileSync(path.join(root, `t${n}`, 'trace.zip'), zip(traceFiles({ browserName: 'chromium', project: 'desktop-chromium' })));
    }
    const out = summarize([root], { env: ENV, cwd: root, maxLines: 100 });
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.join('\n')).toContain('trace-summary: 2 more trace(s) not summarized (the cap of 100 lines)');
  });

  it('reports a trace it cannot read and goes on, and says when there is none', () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'broken'));
    writeFileSync(path.join(root, 'broken', 'trace.zip'), 'not a zip');
    const out = summarize([root], { env: ENV, cwd: root }).join('\n');
    expect(out).toContain('=== broken/trace.zip\n    cannot read this trace: not a zip file');
    expect(summarize([path.join(root, 'nothing-here')], { env: ENV })[0]).toMatch(/^trace-summary: no trace.zip under /);
  });
});

describe('the trace format of the pinned Playwright', () => {
  // When Playwright changes its trace format, this fails: re-read the format in
  // node_modules/playwright-core (lib/coreBundle.js: traceModernizer, Tracing) and node_modules/playwright
  // (lib/worker: TestTracing) and update scripts/trace-summary.mjs and TRACE_VERSION.
  it(`writes trace version ${TRACE_VERSION}, the one scripts/trace-summary.mjs reads`, () => {
    const require = createRequire(import.meta.url);
    const playwright = path.dirname(require.resolve('playwright/package.json', { paths: [path.dirname(require.resolve('@playwright/test/package.json'))] }));
    const core = path.dirname(require.resolve('playwright-core/package.json', { paths: [playwright] }));
    const bundle = readFileSync(path.join(core, 'lib', 'coreBundle.js'), 'utf8');
    expect(bundle.match(/latestVersion = (\d+);/)?.[1]).toBe(String(TRACE_VERSION));
    const worker = readFileSync(path.join(playwright, 'lib', 'worker', 'workerProcessEntry.js'), 'utf8');
    expect(worker.match(/var testTraceEntryName = "test\.trace";\s*var version = (\d+);/)?.[1]).toBe(String(TRACE_VERSION));
  });
});
