// Structured logs (plan §3.1 "Наблюдение", §3.3, §6.4; milestone M12): one JSON line per event on
// standard output, written by pino. Every line has `time` (ISO 8601, UTC), `level` (its label),
// `service` (web or worker) and `msg`; a line about a request also has its `requestId` (the
// X-Request-Id it came with, or the UUIDv7 the server gave it: src/server/audit, requestIdFrom).
// Docker Compose keeps the lines of each container (`docker compose logs web`).
//
// Personal data never reaches a line (CLAUDE.md §6): every field and every message passes through
// ./redact.ts first (names, e-mail and IP addresses, coordinates, secrets; an error keeps only its
// type and code). logger.redaction.test.ts proves it.
//
// No external error service in Phase 1 (plan §3.3): reportError() logs the error and hands it to
// the error provider, which does nothing until hosting is decided. A Sentry provider would plug in
// with setErrorProvider() and must scrub the same way (`sendDefaultPii: false` and ./redact.ts in
// `beforeSend`, plan §6.4).
//
// Only this module imports pino (eslint.config.mjs). LOG_LEVEL (default info) sets the level.

import pino, { type DestinationStream, type Logger, type LevelWithSilent } from 'pino';

import { redactAny, redactFields, redactText } from './redact';

export type { Logger };
export { REDACTED, redactFields, redactText } from './redact';

type Env = Record<string, string | undefined>;

const LEVELS: readonly LevelWithSilent[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** LOG_LEVEL when it names a pino level, otherwise `info`. */
export function logLevel(env: Env = process.env): LevelWithSilent {
  const wanted = (env.LOG_LEVEL ?? '').trim().toLowerCase();
  return (LEVELS as readonly string[]).includes(wanted) ? (wanted as LevelWithSilent) : 'info';
}

export interface LoggerOptions {
  /** The process: `web` (the default) or `worker`. */
  service?: string;
  level?: LevelWithSilent;
  /** Where lines go; standard output (synchronous writes, nothing lost on exit) by default. */
  destination?: DestinationStream;
}

/**
 * pino formats the bindings of the root logger only (a child resets formatters.bindings), so every
 * child's bindings are scrubbed here, and its own children in turn.
 */
type ChildFn = (this: Logger, bindings: Record<string, unknown>, options?: object) => Logger;

function scrubChildren(log: Logger, pinoChild: ChildFn = log.child as unknown as ChildFn): Logger {
  const child: ChildFn = (bindings, options) => scrubChildren(pinoChild.call(log, redactFields(bindings), options), pinoChild);
  log.child = child as unknown as Logger['child'];
  return log;
}

/** A pino logger that removes personal data from every field and message (./redact.ts). */
export function createLogger({ service = 'web', level = logLevel(), destination }: LoggerOptions = {}): Logger {
  const log = pino(
    {
      level,
      // No pid and no hostname: the container says where a line came from.
      base: { service },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: 'msg',
      formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => redactFields(bindings),
        log: (fields) => redactFields(fields),
      },
      hooks: {
        // Every argument is scrubbed before pino sees it: the merging object (an Error, or an Error
        // under `err`, becomes its type and code, so pino has no error message to copy into msg),
        // the message and every printf-style argument (%s, %o, %O, %j of an object or an Error).
        logMethod(args, method) {
          const scrubbed = args.map((arg) => redactAny(arg));
          return method.apply(this, scrubbed as Parameters<typeof method>);
        },
      },
    },
    destination ?? pino.destination({ dest: 1, sync: true }),
  );
  return scrubChildren(log);
}

// One logger per process, kept on globalThis so that `next dev` reloads do not open new streams.
const holder = globalThis as unknown as { __wcrLogger?: Logger };

/** The process's logger (`web` unless the process configured another, as the worker does). */
export function logger(): Logger {
  holder.__wcrLogger ??= createLogger();
  return holder.__wcrLogger;
}

/**
 * Replaces the process's logger (the worker at start: `service: 'worker'`; tests: a destination
 * they read) and returns the one it replaced, so a test can put it back.
 */
export function configureLogger(options: LoggerOptions): Logger | undefined {
  const previous = holder.__wcrLogger;
  holder.__wcrLogger = createLogger(options);
  return previous;
}

/** Puts back a logger that configureLogger() returned (undefined: the default on next use). */
export function restoreLogger(previous: Logger | undefined): void {
  holder.__wcrLogger = previous;
}

/** The logger of one request: every line carries its request id. */
export function requestLogger(requestId: string): Logger {
  return logger().child({ requestId: redactText(requestId).slice(0, 128) });
}

// ---------------------------------------------------------------------------------------------
// Errors (plan §3.3): logged here, then handed to the provider, which does nothing in Phase 1.

/** What a provider receives besides the error: the same scrubbed fields the log line has. */
export type ErrorReport = Record<string, unknown>;
export type ErrorProvider = (error: unknown, report: ErrorReport) => void | Promise<void>;

/** The provider of Phase 1: nothing leaves the machine (no Sentry, plan §3.3). */
export const noErrorProvider: ErrorProvider = () => undefined;

const providerHolder = globalThis as unknown as { __wcrErrorProvider?: ErrorProvider };

/**
 * Connects an error service (with hosting, plan §3.3) and returns the provider it replaced, so a
 * test can put it back; undefined restores the empty provider.
 */
export function setErrorProvider(provider: ErrorProvider | undefined): ErrorProvider | undefined {
  const previous = providerHolder.__wcrErrorProvider;
  providerHolder.__wcrErrorProvider = provider;
  return previous;
}

/**
 * Logs an unexpected error at level error (its type and code, never its message) with `context`
 * (a request id, where it happened), then hands it to the error provider. Never throws.
 */
export async function reportError(error: unknown, context: ErrorReport = {}, log: Logger = logger()): Promise<void> {
  const report = redactFields({ ...context, error: error instanceof Error ? error : { type: typeof error } });
  try {
    log.error(report, 'error reported');
  } catch {
    // A log line that cannot be written must not turn into a second error.
  }
  try {
    await (providerHolder.__wcrErrorProvider ?? noErrorProvider)(error, report);
  } catch {
    // Neither may a provider that fails.
  }
}
