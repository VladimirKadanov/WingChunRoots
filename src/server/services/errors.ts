// Errors a service throws for the caller to show (milestone M02): a stable code, the HTTP status
// the API answers with, and an English message without personal data. The oRPC router turns
// them into ORPCError with the same code and status (src/server/rpc/errors.ts); Server Actions
// show the message next to the form.

export type ServiceErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'SECOND_FACTOR_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TWO_FACTOR_REQUIRED'
  | 'CONSENT_REQUIRED'
  | 'TOO_MANY_REQUESTS'
  | 'ENTITLEMENT_REQUIRED'
  // M10a: the evidence upload (plan §6.4).
  | 'LENGTH_REQUIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE';

export const SERVICE_ERROR_STATUS: Record<ServiceErrorCode, number> = {
  BAD_REQUEST: 400,
  CONSENT_REQUIRED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  SECOND_FACTOR_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TWO_FACTOR_REQUIRED: 409,
  // M08: a limit against floods (pilot access requests to the admins).
  TOO_MANY_REQUESTS: 429,
  // M09: the plan does not allow one more (requireEntitlement's refusal travels in `data.entitlement`).
  ENTITLEMENT_REQUIRED: 403,
  // M10a: an upload without Content-Length, over 20 MB (DEFAULT D25), or not JPEG, PNG, WebP or PDF.
  LENGTH_REQUIRED: 411,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

export class ServiceError extends Error {
  readonly status: number;
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    /** Field-level problems for a form: field name → message. */
    readonly fields: Readonly<Record<string, string>> = {},
    /**
     * Machine-readable details beside the message (M09): for ENTITLEMENT_REQUIRED, the refusal of
     * requireEntitlement(), from which a client builds the upgrade prompt (plan §6.5). No personal data.
     */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ServiceError';
    this.status = SERVICE_ERROR_STATUS[code];
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/** The PostgreSQL error inside a Drizzle error (DrizzleQueryError keeps it as `cause`). */
export function pgErrorOf(error: unknown): { code?: string; constraint?: string } | null {
  let e = error as { code?: unknown; constraint?: unknown; cause?: unknown } | null;
  for (let depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    if (typeof e.code === 'string') return e as { code?: string; constraint?: string };
    e = e.cause as typeof e;
  }
  return null;
}
