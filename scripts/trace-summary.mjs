#!/usr/bin/env node
// scripts/trace-summary.mjs [dir ...] [--max-lines-per-test 300] [--max-lines 2400]
//
// A compact summary of every Playwright trace under test-results/ (the default dir), for the job
// log of CI. Playwright keeps a trace only for a failed test (trace: 'retain-on-failure' in
// playwright.config.ts), and mobile-webkit runs only in CI, whose artifacts this project often
// cannot download: so the job log has to carry what the trace viewer would show. For each
// trace.zip, WebKit first:
//
//   - the test's title and project, the browser and its viewport;
//   - the page errors (uncaught exceptions) with their stack, and the browser console messages of
//     level error and warning, plus any React hydration message whatever its level;
//   - the action timeline: every Playwright action, expect, step, hook and fixture with its start
//     (seconds from the test's start), its duration and the first line of its error;
//   - the requests for documents, fetch/XHR, Server Actions and RSC (method, URL path, status,
//     time), and every request that failed or got a status of 400 or more, whatever its type;
//   - the failing line of the test source from error-context.md, next to the trace.
//
// Privacy (CLAUDE.md §6, §12): of the zip only the *.trace and *.network files are read, never
// resources/ (bodies, DOM snapshots, screenshots, sources), and of those only what is listed above
// is printed. Request and response bodies, headers (their names only tell a Server Action or an RSC
// request apart), cookies, form data, storage, console arguments, action parameters (what was
// typed into fields), action logs, the test's stdout and custom expect messages (the tests pass
// response bodies as messages, and a body can hold a session token) are never printed; neither is
// error-context.md's page snapshot, an aria snapshot that holds what was typed into fields,
// passwords included. Query strings and fragments are cut from every URL and replaced by "?…",
// long token-like path segments become ":token", and every printed text also goes through
// scrub(): the values of the secret settings that the job has in its environment (E2E_PASSWORD,
// E2E_TOTP_SECRET, BETTER_AUTH_SECRET, …, the passwords in the database and SMTP URLs),
// credentials in URLs, Bearer/Basic values, cookie/authorization header lines, token=… pairs and
// "token": … JSON values become "***".
//
// The trace format is that of Playwright 1.64.1 (trace version 10; node_modules/playwright-core
// lib/coreBundle.js: traceModernizer, traceLoader, Tracing; node_modules/playwright lib/worker:
// TestTracing): a zip with test.trace (the test runner's steps) and, for each browser or API
// request context, <n>-trace.trace (actions, console, page errors) and <n>-trace.network (HAR
// entries). Node only, no dependency and no unzip: the zip is read with node:zlib, so it also
// runs in Git Bash on Windows. It exits 0 whatever the traces hold (a diagnostic step must not
// add a failure of its own), and 2 only on a wrong command line.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

/** The trace format this parser reads (context-options.version of Playwright 1.64.1). */
export const TRACE_VERSION = 10;
export const DEFAULT_MAX_LINES_PER_TEST = 300;
export const DEFAULT_MAX_LINES = 2400;
/** Below this, a test's summary is not worth printing: the total cap stops earlier instead. */
const MIN_LINES_PER_TEST = 60;
/** Longer lines are cut: one long console message must not fill the log. */
const MAX_LINE = 400;

// --- zip ----------------------------------------------------------------------------------

/** The entries of a zip file from its central directory (ZIP64 included). */
export function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory record)');
  let count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || buf.readUInt32LE(locator) !== 0x07064b50) throw new Error('ZIP64 locator missing');
    const record = Number(buf.readBigUInt64LE(locator + 8));
    if (buf.readUInt32LE(record) !== 0x06064b50) throw new Error('ZIP64 end of central directory missing');
    count = Number(buf.readBigUInt64LE(record + 32));
    offset = Number(buf.readBigUInt64LE(record + 48));
  }
  const entries = [];
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    // The ZIP64 extra field holds, in this order, the values that are 0xffffffff above.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = buf.readUInt16LE(e);
      const length = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        const next = () => {
          const value = Number(buf.readBigUInt64LE(q));
          q += 8;
          return value;
        };
        if (size === 0xffffffff) size = next();
        if (compressedSize === 0xffffffff) compressedSize = next();
        if (localOffset === 0xffffffff) localOffset = next();
      }
      e += 4 + length;
    }
    entries.push({ name, method, compressedSize, size, localOffset });
    p = extraEnd + commentLength;
  }
  return entries;
}

/** The content of one zip entry (stored or deflated). */
export function zipRead(buf, entry) {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`corrupt local header of ${entry.name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
}

/** The trace files of a trace.zip (*.trace, *.network), as text; never resources or snapshots. */
export function readTraceZip(buf) {
  const files = new Map();
  for (const entry of zipEntries(buf)) {
    if (/^[^/]+\.(trace|network)$/.test(entry.name)) files.set(entry.name, zipRead(buf, entry).toString('utf8'));
  }
  return files;
}

// --- scrubbing ----------------------------------------------------------------------------

/** The settings whose values are secret (.env.example, ci.yml, scripts/cloud-setup.sh). */
export const SECRET_ENV = [
  'E2E_PASSWORD',
  'E2E_TOTP_SECRET',
  'BETTER_AUTH_SECRET',
  'IP_HMAC_KEY',
  'MAIL_SEAL_KEY',
  'DB_MIGRATOR_PASSWORD',
  'DB_APP_RW_PASSWORD',
  'DB_APP_PUBLIC_RO_PASSWORD',
];
/** The settings that are URLs with a password in them. */
export const SECRET_URL_ENV = ['TEST_DATABASE_URL', 'DATABASE_URL', 'SMTP_URL'];

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'<>]+:)[^\s@/"'<>]+@/gi;
// A query string after a URL or a path, with the fragment after it: everything from "?" up to
// white space, a quote, a parenthesis or a brace ("args[]=…" included).
const QUERY = /((?:\b[a-z][a-z0-9+.-]*:\/\/|\/)[^\s"'`<>()[\]{}?#]*)\?[^\s"'`<>(){}#]*(?:#[^\s"'`<>(){}]*)?/gi;
// A query string with no path before it: "?q=…" on its own.
const BARE_QUERY = /(^|[\s"'`(=])\?[A-Za-z0-9_.%[\]-]+=[^\s"'`<>(){}]*/g;
const FRAGMENT = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()[\]{}#]*)#[^\s"'`<>()[\]{}]*/gi;
const AUTH_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const HEADER_LINE = /\b(set-cookie|cookie|authorization|proxy-authorization|x-api-key)(\s*[:=]\s*)[^\n]*/gi;
// The same names as JSON keys ("token":"…"), for a response body that ended up in a message.
const JSON_SECRET =
  /("(?:token|access_?token|refresh_?token|id_?token|session_?token|session|password|passwd|secret|code|otp|key|api_?key|backup_?codes?|totp_?uri|cookie)"\s*:\s*)(\[[^\]]*\]|"(?:[^"\\]|\\.)*"|[^,}\]\s]+)/gi;
const KEY_VALUE =
  /\b(token|access_token|refresh_token|id_token|code|otp|password|passwd|pwd|secret|session|session_token|sig|signature|key|api_key|apikey)=([^&\s"';,]+)/gi;

/**
 * A function that removes secrets from a text that is about to be printed (see the header).
 * @param {Record<string, string | undefined>} [env]
 * @returns {(input: unknown) => string}
 */
export function makeScrubber(env = process.env) {
  const secrets = new Set();
  for (const name of SECRET_ENV) {
    const value = env[name];
    if (value && value.length >= 4) secrets.add(value);
  }
  for (const name of SECRET_URL_ENV) {
    try {
      const { password } = new URL(env[name] ?? '');
      if (password) {
        secrets.add(password);
        secrets.add(decodeURIComponent(password));
      }
    } catch {
      // not a URL: nothing to take from it
    }
  }
  const ordered = [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
  return (input) => {
    let text = String(input ?? '').replace(ANSI, '');
    for (const secret of ordered) text = text.split(secret).join('***');
    return text
      .replace(URL_CREDENTIALS, '$1***@')
      .replace(QUERY, '$1?…')
      .replace(BARE_QUERY, '$1?…')
      .replace(FRAGMENT, '$1#…')
      .replace(AUTH_VALUE, '$1 ***')
      .replace(HEADER_LINE, '$1$2***')
      .replace(KEY_VALUE, '$1=***')
      .replace(JSON_SECRET, '$1"***"');
  };
}

/** A path segment that looks like a token or a key rather than a slug, an id or a file name. */
export function tokenLike(segment) {
  if (segment.length < 20 || !/^[A-Za-z0-9_-]+$/.test(segment)) return false;
  if (!/\d/.test(segment) || !/[A-Za-z]/.test(segment)) return false;
  // Demo slugs and UUIDs are lower case with hyphens; a token is mixed case or has no hyphen.
  return !segment.includes('-') || (/[a-z]/.test(segment) && /[A-Z]/.test(segment));
}

/**
 * A URL as the summary prints it: the path only (decoded), with "?…" where a query string was
 * and ":token" for token-like segments; the origin only when it is not `origin`.
 */
export function urlPath(raw, origin, scrub = (s) => s) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return scrub(String(raw ?? '').replace(/[?#][\s\S]*$/, (m) => (m.startsWith('?') ? '?…' : '')));
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return `${url.protocol}…`;
  if (!/^(https?|wss?|file):$/.test(url.protocol)) return `${url.protocol}…`;
  const pathname = url.pathname
    .split('/')
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // keep it encoded
      }
      return tokenLike(decoded) ? ':token' : decoded;
    })
    .join('/');
  const prefix = origin && url.origin === origin ? '' : `${url.protocol}//${url.host}`;
  return scrub(prefix + pathname) + (url.search ? '?…' : '');
}

// --- parsing ------------------------------------------------------------------------------

function parseLines(text) {
  const events = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A trace cut short (a crashed worker) ends in a partial line.
    }
  }
  return events;
}

/**
 * The parts of a trace the summary uses, with every time in milliseconds from the test's start.
 * `files` maps the zip's entry names (test.trace, 0-trace.trace, 0-trace.network, …) to text.
 */
export function parseTrace(files) {
  const contexts = [];
  for (const [name, text] of files) {
    if (!name.endsWith('.trace')) continue;
    const prefix = name.slice(0, -'.trace'.length);
    const events = parseLines(text);
    const network = parseLines(files.get(`${prefix}.network`));
    const options = events.find((e) => e.type === 'context-options') ?? {};
    contexts.push({ name, origin: options.origin ?? (prefix === 'test' ? 'testRunner' : 'library'), options, events, network });
  }
  const runner = contexts.find((c) => c.origin === 'testRunner');
  const libraries = contexts.filter((c) => c !== runner).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  // The time base: the test runner's clock; a library context is moved onto it like the trace
  // viewer does (traceModel.ts: timeOrigin = wallTime - monotonicTime).
  const timeOrigin = (o) => (o.wallTime ?? 0) - (o.monotonicTime ?? 0);
  const t0 =
    runner?.options.monotonicTime ||
    Math.min(...libraries.map((c) => c.options.monotonicTime || Infinity).filter(Number.isFinite), Infinity);
  const base = Number.isFinite(t0) ? t0 : 0;
  const shiftOf = (c) =>
    runner?.options.monotonicTime && c.options.monotonicTime ? timeOrigin(c.options) - timeOrigin(runner.options) : 0;

  const model = {
    version: runner?.options.version ?? libraries[0]?.options.version,
    title: '',
    project: '',
    browserName: '',
    viewport: null,
    isMobile: false,
    hasTouch: false,
    playwrightVersion: '',
    testTimeout: runner?.options.testTimeout,
    steps: [],
    testErrors: [],
    console: [],
    pageErrors: [],
    requests: [],
    duration: 0,
  };

  // Steps of the test runner: before/after pairs by callId.
  const steps = new Map();
  for (const e of runner?.events ?? []) {
    if (e.type === 'before') {
      steps.set(e.callId, {
        id: e.callId,
        parentId: e.parentId,
        category: e.method,
        title: e.title ?? '',
        subtitle: e.subtitle,
        url: typeof e.params?.url === 'string' ? e.params.url : undefined,
        group: e.group,
        start: e.startTime - base,
        end: undefined,
        error: undefined,
      });
      for (const frame of e.stack ?? []) {
        const match = /^project#(.+)$/.exec(frame.file ?? '');
        if (match && !model.project) model.project = match[1];
      }
    } else if (e.type === 'after') {
      const step = steps.get(e.callId);
      if (!step) continue;
      step.end = e.endTime - base;
      if (e.error) step.error = e.error.message ?? e.error.value ?? String(e.error);
    } else if (e.type === 'error') {
      model.testErrors.push(e.message ?? '');
    }
  }
  const depthOf = (step) => {
    let depth = 0;
    for (let p = steps.get(step.parentId); p && depth < 20; p = steps.get(p.parentId)) depth++;
    return depth;
  };
  for (const step of steps.values()) {
    step.depth = depthOf(step);
    model.steps.push(step);
  }
  model.steps.sort((a, b) => a.start - b.start);

  // Library contexts: console, page errors, requests.
  const pages = new Map();
  const pageTag = (pageId) => {
    if (!pageId) return '';
    if (!pages.has(pageId)) pages.set(pageId, `p${pages.size + 1}`);
    return pages.get(pageId);
  };
  let firstDocumentOrigin = '';
  for (const context of libraries) {
    const shift = shiftOf(context) - base;
    const o = context.options;
    if (o.title && !model.title) model.title = o.title;
    if (o.playwrightVersion && !model.playwrightVersion) model.playwrightVersion = o.playwrightVersion;
    if (o.browserName && !model.browserName) {
      model.browserName = o.browserName;
      model.viewport = o.options?.viewport ?? null;
      model.isMobile = Boolean(o.options?.isMobile);
      model.hasTouch = Boolean(o.options?.hasTouch);
    }
    for (const e of context.events) {
      if (e.type === 'event' && (e.method === 'page' || e.method === 'pageClosed')) pageTag(e.params?.pageId);
      if (e.type === 'console') {
        model.console.push({
          time: e.time + shift,
          level: e.messageType ?? 'log',
          text: e.text ?? '',
          url: e.location?.url,
          line: e.location?.lineNumber,
          column: e.location?.columnNumber,
          page: pageTag(e.pageId),
        });
      } else if (e.type === 'event' && e.method === 'pageError') {
        const error = e.params?.error;
        model.pageErrors.push({
          time: e.time + shift,
          name: error?.error?.name ?? '',
          message: error?.error?.message ?? String(error?.value ?? ''),
          stack: error?.error?.stack ?? '',
          page: pageTag(e.pageId),
        });
      }
    }
    for (const e of context.network) {
      if (e.type !== 'resource-snapshot' || !e.snapshot) continue;
      const s = e.snapshot;
      const headerNames = new Set((s.request?.headers ?? []).map((h) => String(h.name).toLowerCase()));
      let kind = s._resourceType ?? (s._apiRequest || s._apiRequestRef ? 'api' : 'other');
      if (headerNames.has('next-action')) kind = 'action';
      else if (headerNames.has('next-router-prefetch')) kind = 'prefetch';
      else if (headerNames.has('rsc')) kind = 'rsc';
      if (kind === 'document' && !firstDocumentOrigin) {
        try {
          firstDocumentOrigin = new URL(s.request.url).origin;
        } catch {
          // not a URL
        }
      }
      model.requests.push({
        time: s._monotonicTime ? s._monotonicTime + shift : undefined,
        method: s.request?.method ?? '',
        url: s.request?.url ?? '',
        status: s.response?.status ?? -1,
        failure: s.response?._failureText ?? undefined,
        duration: typeof s.time === 'number' ? s.time : undefined,
        kind,
        route: s._wasAborted ? 'aborted' : s._wasFulfilled ? 'fulfilled' : s._wasContinued ? 'continued' : '',
        page: pageTag(s.pageref),
      });
    }
  }
  model.requests.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  model.console.sort((a, b) => a.time - b.time);
  model.pageErrors.sort((a, b) => a.time - b.time);
  model.origin = firstDocumentOrigin;
  model.pageCount = pages.size;
  model.duration = Math.max(0, ...model.steps.map((s) => s.end ?? s.start));
  return model;
}

// --- rendering ----------------------------------------------------------------------------

const HYDRATION =
  /hydrat|did(?: not|n't) match|server rendered (?:html|text)|Minified React error #(?:418|419|421|422|423|425)\b|react\.dev\/errors\/(?:418|419|421|422|423|425)\b/i;

/** Console messages worth printing: errors, warnings and anything about React hydration. */
export function consoleWorthPrinting(message) {
  return ['error', 'warning', 'assert'].includes(message.level) || HYDRATION.test(message.text);
}

const KEY_NAMES = new Set([
  'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Shift', 'Control', 'Alt', 'Meta',
  'ControlOrMeta', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

function keyLike(value) {
  const parts = value.split('+');
  return parts.every((part, i) => {
    if (KEY_NAMES.has(part)) return true;
    if (i !== parts.length - 1 || part.length !== 1) return false;
    // A single character: punctuation alone ("/"), a letter or digit only after a modifier.
    return parts.length > 1 || !/[A-Za-z0-9]/.test(part);
  });
}

/**
 * The title of a Playwright API call without the values it carries: `Fill "…"`, `Type "…"`,
 * `Insert "…"` (what was typed: passwords, codes). Key names, attribute names, event types and
 * expect expressions stay.
 */
export function safeApiTitle(title) {
  return String(title).replace(/"[\s\S]*"/, (quoted) => {
    const value = quoted.slice(1, -1);
    if (/^(Press|Key down|Key up) /.test(title) && keyLike(value)) return quoted;
    if (/^Get attribute /.test(title) && /^[\w:-]{1,40}$/.test(value)) return quoted;
    if (/^Dispatch /.test(title) && /^[a-z]{1,30}$/.test(value)) return quoted;
    if (/^Expect /.test(title) && /^[a-z]+(\.[a-z]+)+$/i.test(value)) return quoted;
    return '"…"';
  });
}

/** The title Playwright gives an expect step without a custom message (`expect(x, message)`). */
const DEFAULT_EXPECT_TITLE = /^Expect "(?:(?:poll|soft|not) )*[A-Za-z]+(?:\([^"\n]*\))?"$/;

/**
 * The first line of an error message that is not a custom expect message: the tests pass response
 * bodies as messages (`expect(response.status(), await response.text())`), and a body can hold a
 * session token. `hidden` holds the first lines of those messages.
 */
export function errorHeadline(message, hidden = []) {
  const lines = String(message ?? '')
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const bare = line.replace(/^Error:\s*/, '');
    if (!bare || hidden.some((h) => bare.includes(h) || h.includes(bare))) continue;
    return line;
  }
  return '(not shown: a custom expect message)';
}

const firstLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? '';

const seconds = (ms) =>
  (ms === undefined || !Number.isFinite(ms) ? '?' : `${ms < 0 ? '-' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}s`).padStart(8);
const duration = (ms) => {
  if (ms === undefined || !Number.isFinite(ms)) return 'no end';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};
const cut = (line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line);

const CATEGORY = { 'pw:api': 'api', expect: 'expect', 'test.step': 'step', hook: 'hook', fixture: 'fixture' };

/** The failing line of the test source in error-context.md, and the lines just before it. */
export function errorContextExcerpt(markdown, scrub = (s) => s, before = 6) {
  const lines = String(markdown ?? '').split('\n');
  const heading = lines.findIndex((l) => l.trim() === '# Test source');
  if (heading < 0) return [];
  const open = lines.findIndex((l, i) => i > heading && l.startsWith('```'));
  if (open < 0) return [];
  const marker = lines.findIndex((l, i) => i > open && /^> /.test(l));
  if (marker < 0) return [];
  const close = lines.findIndex((l, i) => i > marker && l.startsWith('```'));
  const end = Math.min(close < 0 ? lines.length : close, marker + 2);
  return lines.slice(Math.max(open + 1, marker - before), end).map((l) => scrub(l));
}

/**
 * Picks whole items within `limit` lines: the important ones first, then the others from the
 * end (`prefer: 'last'`, the steps and requests just before the failure) or from the start
 * (`'first'`, the first errors, often the cause of the rest). Keeps their order.
 */
export function pick(items, limit, prefer, noun) {
  const total = items.reduce((n, item) => n + item.lines.length, 0);
  if (total <= limit) return items.flatMap((item) => item.lines);
  const room = Math.max(0, limit - 1);
  const order = items.map((item, i) => i);
  const rank = (i) => (prefer === 'last' ? -i : i);
  order.sort((a, b) => Number(Boolean(items[b].important)) - Number(Boolean(items[a].important)) || rank(a) - rank(b));
  const chosen = new Set();
  let used = 0;
  for (const i of order) {
    const length = items[i].lines.length;
    if (used + length <= room) {
      chosen.add(i);
      used += length;
    }
  }
  const lines = items.filter((item, i) => chosen.has(i)).flatMap((item) => item.lines);
  const note = `  … ${items.length - chosen.size} of ${items.length} ${noun} not shown (kept: errors first, then the ${prefer === 'last' ? 'latest' : 'earliest'})`;
  return prefer === 'last' ? [note, ...lines] : [...lines, note];
}

/** Shares `budget` lines among sections by weight; what one does not need goes to the others, by weight. */
export function allocate(needs, weights, budget) {
  const given = needs.map(() => 0);
  let left = budget;
  for (let round = 0; round < 20 && left > 0; round++) {
    const open = needs.map((_, i) => i).filter((i) => given[i] < needs[i]);
    const total = open.reduce((sum, i) => sum + weights[i], 0);
    let spent = 0;
    for (const i of open) {
      const share = Math.max(1, Math.floor((left * weights[i]) / total));
      const more = Math.min(needs[i] - given[i], share, left - spent);
      given[i] += more;
      spent += more;
    }
    if (spent === 0) break;
    left -= spent;
  }
  return given;
}

/**
 * The summary of one test's trace, at most `maxLines` lines.
 * @param {ReturnType<typeof parseTrace>} model
 * @param {{ maxLines?: number, scrub?: (input: unknown) => string, tracePath?: string, excerpt?: string[] }} [options]
 * @returns {string[]}
 */
export function renderSummary(model, { maxLines = DEFAULT_MAX_LINES_PER_TEST, scrub = makeScrubber(), tracePath = '', excerpt = [] } = {}) {
  const tag = (page) => (model.pageCount > 1 && page ? `[${page}] ` : '');
  // Free text (messages, stacks): scrubbed, and the app's own origin left out of its URLs.
  const text = (t) => (model.origin ? scrub(t).split(model.origin).join('') : scrub(t));
  const header = [];
  const where = model.title || path.basename(path.dirname(tracePath)) || tracePath;
  header.push(`=== [${model.project || 'unknown project'}] ${scrub(where)}`);
  if (tracePath) header.push(`    trace: ${scrub(tracePath)}`);
  const browser = [
    model.browserName || 'no browser',
    model.viewport ? `${model.viewport.width}x${model.viewport.height}` : '',
    model.isMobile ? 'mobile' : '',
    model.hasTouch ? 'touch' : '',
  ].filter(Boolean);
  const facts = [
    browser.join(' '),
    model.playwrightVersion ? `Playwright ${model.playwrightVersion}` : '',
    model.testTimeout ? `test timeout ${duration(model.testTimeout)}` : '',
    `${duration(model.duration)} recorded`,
  ].filter(Boolean);
  header.push(`    ${facts.join(', ')}`);
  if (model.version && model.version !== TRACE_VERSION) {
    header.push(`    note: trace format ${model.version}; this summary was written for format ${TRACE_VERSION} (Playwright 1.64.1)`);
  }
  // Custom expect messages are never printed, neither as a step title nor in an error.
  const customMessages = model.steps
    .filter((step) => step.category === 'expect' && !DEFAULT_EXPECT_TITLE.test(step.title))
    .map((step) => firstLine(step.title))
    .filter(Boolean);
  for (const error of model.testErrors.slice(0, 3)) header.push(`    test error: ${text(errorHeadline(error, customMessages))}`);

  // Page errors, deduplicated, with their stack.
  const pageErrors = [];
  const seenErrors = new Map();
  for (const error of model.pageErrors) {
    const key = `${error.message}\n${error.stack}`;
    const known = seenErrors.get(key);
    if (known) {
      known.count++;
      known.lines[0] = `  ${known.head} (×${known.count})`;
      continue;
    }
    const hydration = HYDRATION.test(error.message) ? '[hydration] ' : '';
    const head = `${seconds(error.time)} ${tag(error.page)}${hydration}${text(firstLine(error.name && !error.message.startsWith(error.name) ? `${error.name}: ${error.message}` : error.message))}`;
    const stackLines = String(error.stack ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // A V8 stack starts with "Name: message", which the head already shows; JSC's does not.
    if (stackLines[0] && firstLine(error.message) && stackLines[0].includes(firstLine(error.message))) stackLines.shift();
    const stack = stackLines.slice(0, 10).map((l) => `      ${text(l)}`);
    const item = { head, count: 1, lines: [`  ${head}`, ...stack], important: true };
    seenErrors.set(key, item);
    pageErrors.push(item);
  }

  // Console messages, deduplicated.
  const consoleItems = [];
  const seenConsole = new Map();
  for (const message of model.console.filter(consoleWorthPrinting)) {
    const where = message.url ? ` (at ${urlPath(message.url, model.origin, scrub)}:${(message.line ?? 0) + 1}:${(message.column ?? 0) + 1})` : '';
    const key = `${message.level}\n${message.text}\n${where}`;
    const known = seenConsole.get(key);
    if (known) {
      known.count++;
      known.lines[0] = `${known.head} (×${known.count})`;
      continue;
    }
    const hydration = HYDRATION.test(message.text) ? '[hydration] ' : '';
    const textLines = text(message.text).split('\n').filter((l) => l.trim());
    const head = `  ${seconds(message.time)} ${tag(message.page)}${message.level.padEnd(7)} ${hydration}${textLines[0] ?? ''}${where}`;
    const item = {
      head,
      count: 1,
      lines: [head, ...textLines.slice(1, 6).map((l) => `      ${l.trim()}`)],
      important: message.level === 'error' || Boolean(hydration),
    };
    seenConsole.set(key, item);
    consoleItems.push(item);
  }

  // The action timeline (no configuration fixtures, no attachments).
  const timeline = model.steps
    .filter((step) => step.group !== 'configuration' && step.category !== 'test.attach')
    .map((step) => {
      let title = step.title;
      if (step.category === 'pw:api') title = safeApiTitle(step.title);
      else if (step.category === 'expect' && !DEFAULT_EXPECT_TITLE.test(step.title)) title = 'Expect (custom message not shown)';
      const subtitle = step.url !== undefined ? urlPath(step.url, model.origin) : (step.subtitle ?? '');
      const length = step.end === undefined ? undefined : step.end - step.start;
      const prefix = `  ${seconds(step.start)} ${duration(length).padStart(7)}  ${(CATEGORY[step.category] ?? step.category ?? '').padEnd(7)} ${'  '.repeat(step.depth)}`;
      const lines = [`${prefix}${scrub(`${title}${subtitle ? ` ${subtitle}` : ''}`)}`];
      if (step.error) lines.push(`${' '.repeat(prefix.length)}error: ${text(errorHeadline(step.error, customMessages))}`);
      return { lines, important: Boolean(step.error) };
    });

  // Requests: documents, fetch/XHR, Server Actions, RSC, API calls, and every failure.
  const listed = new Set(['document', 'fetch', 'xhr', 'action', 'rsc', 'api', 'eventsource', 'websocket']);
  const others = new Map();
  const requests = [];
  for (const request of model.requests) {
    // A prefetch that got its answer and was then dropped (net::ERR_ABORTED after a navigation) is
    // routine; any other failure text, or no answer at all, is not.
    const failed = request.status >= 400 || request.status <= 0 || (Boolean(request.failure) && request.kind !== 'prefetch');
    if (!failed && !listed.has(request.kind)) {
      others.set(request.kind, (others.get(request.kind) ?? 0) + 1);
      continue;
    }
    const status = request.status > 0 ? String(request.status) : 'ERR';
    const extra = [request.failure, request.route].filter(Boolean).join(', ');
    const line = `  ${seconds(request.time)} ${tag(request.page)}${request.method.padEnd(6)} ${status.padEnd(4)} ${duration(request.duration).padStart(7)}  ${request.kind.padEnd(9)} ${urlPath(request.url, model.origin, scrub)}${extra ? `  (${scrub(extra)})` : ''}`;
    requests.push({ lines: [line], important: failed });
  }
  const otherCounts = [...others].map(([kind, n]) => `${n} ${kind}`).join(', ');

  const sections = [
    { title: `page errors (${model.pageErrors.length})`, items: pageErrors, prefer: 'first', noun: 'page errors', weight: 13 },
    { title: `console errors and warnings (${consoleItems.length} distinct)`, items: consoleItems, prefer: 'first', noun: 'messages', weight: 20 },
    { title: `actions (${timeline.length}; start from the test's start, duration)`, items: timeline, prefer: 'last', noun: 'steps', weight: 37 },
    {
      title: `requests (${requests.length}${otherCounts ? `; not listed, none with an error status: ${otherCounts}` : ''})`,
      items: requests,
      prefer: 'last',
      noun: 'requests',
      weight: 25,
    },
    { title: 'test source at the failure (error-context.md)', items: excerpt.length ? [{ lines: excerpt.map((l) => `  ${l}`) }] : [], prefer: 'first', noun: 'lines', weight: 5 },
  ];
  const visible = sections.filter((s) => s.items.length > 0 || s.noun !== 'lines');
  const needs = visible.map((s) => 1 + Math.max(1, s.items.reduce((n, item) => n + item.lines.length, 0)));
  const budget = Math.max(0, maxLines - header.length);
  const shares = allocate(needs, visible.map((s) => s.weight), budget);
  const out = [...header];
  visible.forEach((section, i) => {
    const room = shares[i];
    if (room <= 0) return;
    out.push(`  -- ${section.title}`);
    if (!section.items.length) {
      if (room > 1) out.push('  (none)');
      return;
    }
    out.push(...pick(section.items, room - 1, section.prefer, section.noun));
  });
  return out.slice(0, maxLines).map(cut);
}

// --- files --------------------------------------------------------------------------------

/** Every trace.zip below `dir`, sorted by path. */
export function findTraces(dir) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
      else if (entry.isFile() && entry.name === 'trace.zip') found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Summaries of every trace below `dirs`, WebKit first, within the caps.
 * @param {string[]} dirs
 * @param {{ maxLinesPerTest?: number, maxLines?: number, env?: Record<string, string | undefined>, cwd?: string }} [options]
 * @returns {string[]}
 */
export function summarize(dirs, { maxLinesPerTest = DEFAULT_MAX_LINES_PER_TEST, maxLines = DEFAULT_MAX_LINES, env = process.env, cwd = process.cwd() } = {}) {
  const scrub = makeScrubber(env);
  const traces = dirs.flatMap((dir) => findTraces(dir));
  const out = [];
  if (!traces.length) {
    out.push(`trace-summary: no trace.zip under ${dirs.join(', ')} (Playwright keeps one per failed test).`);
    return out;
  }
  const parsed = traces.map((file) => {
    const shown = path.relative(cwd, file).split(path.sep).join('/');
    try {
      return { file, shown, model: parseTrace(readTraceZip(readFileSync(file))) };
    } catch (error) {
      return { file, shown, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const webkitFirst = (p) => (p.model?.browserName === 'webkit' ? 0 : 1);
  parsed.sort((a, b) => webkitFirst(a) - webkitFirst(b) || a.shown.localeCompare(b.shown));
  // The first line, a blank line before each test and the two closing lines are part of the cap.
  const perTest = Math.min(maxLinesPerTest, maxLines - 4, Math.max(MIN_LINES_PER_TEST, Math.floor((maxLines - 3) / parsed.length) - 1));
  out.push(
    `trace-summary: ${parsed.length} trace(s) of failed tests under ${dirs.join(', ')}, WebKit first; at most ${perTest} lines each. ` +
      'Times are seconds from the test start. No bodies, headers, cookies, query strings or snapshots.',
  );
  let printed = 0;
  for (const [i, p] of parsed.entries()) {
    let lines;
    if (p.error) {
      lines = [`=== ${scrub(p.shown)}`, `    cannot read this trace: ${scrub(p.error)}`];
    } else {
      const contextFile = path.join(path.dirname(p.file), 'error-context.md');
      const excerpt = existsSync(contextFile) ? errorContextExcerpt(readFileSync(contextFile, 'utf8'), scrub) : [];
      lines = renderSummary(p.model, { maxLines: perTest, scrub, tracePath: p.shown, excerpt });
    }
    if (out.length + 1 + lines.length + 2 > maxLines) {
      out.push(`trace-summary: ${parsed.length - i} more trace(s) not summarized (the cap of ${maxLines} lines); the verify-log artifact has them all.`);
      break;
    }
    out.push('', ...lines);
    printed++;
  }
  if (printed === parsed.length) out.push('', `trace-summary: ${printed} trace(s) summarized.`);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const dirs = [];
  const numbers = { '--max-lines-per-test': DEFAULT_MAX_LINES_PER_TEST, '--max-lines': DEFAULT_MAX_LINES };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg in numbers) {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 10) {
        console.error(`trace-summary: ${arg} needs a whole number of at least 10`);
        process.exit(2);
      }
      numbers[arg] = value;
    } else if (arg.startsWith('--')) {
      console.error('usage: node scripts/trace-summary.mjs [dir ...] [--max-lines-per-test 300] [--max-lines 2400]');
      process.exit(2);
    } else {
      dirs.push(arg);
    }
  }
  try {
    const lines = summarize(dirs.length ? dirs : ['test-results'], {
      maxLinesPerTest: numbers['--max-lines-per-test'],
      maxLines: numbers['--max-lines'],
    });
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (error) {
    // Never fail the step: it only adds diagnostics to a job that has already failed.
    console.log(`trace-summary: could not summarize the traces (${makeScrubber()(error instanceof Error ? error.message : String(error))})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
