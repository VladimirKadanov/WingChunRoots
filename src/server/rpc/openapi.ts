// The OpenAPI contract of /api/v1 (plan §6.8; milestone M04): generated from the router, so every
// procedure is in it, and written to docs/api/openapi.json by `pnpm api:openapi`. CI runs
// `pnpm api:openapi --check`, which fails when the committed file differs from the router.
//
// The schemas come from Zod 4's own JSON Schema output (z.toJSONSchema), through a small
// converter for oRPC's OpenAPIGenerator, so the contract needs no extra package. The output is
// deterministic: the router's order, no dates, two-space JSON with a final newline.

import { type ConditionalSchemaConverter, type JSONSchema, OpenAPIGenerator, type SchemaConvertOptions } from '@orpc/openapi';
import * as z from 'zod';

import { router } from './router';

export const OPENAPI_FILE = 'docs/api/openapi.json';

/** Zod 4 schemas → JSON Schema (draft 2020-12, which OpenAPI 3.1 uses). */
export class Zod4SchemaConverter implements ConditionalSchemaConverter {
  condition(schema: unknown): boolean {
    return schema instanceof z.ZodType;
  }

  convert(schema: unknown, options: SchemaConvertOptions): [required: boolean, jsonSchema: JSONSchema] {
    const zod = schema as z.ZodType;
    const json = z.toJSONSchema(zod, { io: options.strategy, unrepresentable: 'any', target: 'draft-2020-12' }) as Record<string, unknown>;
    delete json.$schema;
    // Optional when undefined is a valid value (an optional or defaulted field, an empty body).
    const required = !zod.safeParse(undefined).success;
    return [required, json as JSONSchema];
  }
}

/** The error body of every procedure (oRPC's error JSON; the router's middleware sets code and message). */
const ERROR_SCHEMA = {
  type: 'object',
  required: ['defined', 'code', 'status', 'message'],
  properties: {
    defined: { type: 'boolean' },
    code: { type: 'string', examples: ['BAD_REQUEST', 'NOT_FOUND'] },
    status: { type: 'integer' },
    message: { type: 'string' },
    data: {
      type: 'object',
      properties: {
        /** Field name → message, for input that failed its schema. */
        fields: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  },
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

type Operation = { parameters?: unknown[]; requestBody?: unknown; responses?: Record<string, unknown> };

/**
 * The answers that are not 200, which the generator leaves out: 400 for input that fails its schema
 * (every procedure with input; src/server/rpc/router.ts), and 404 for a lineage or people read
 * about a person who is missing or not public (the same body for both, docs/api/lineage.md). And
 * the two ways to send a session: optional, since lineage reads are public.
 */
export function documentErrors(document: Record<string, unknown>): Record<string, unknown> {
  const paths = (document.paths ?? {}) as Record<string, Record<string, Operation>>;
  for (const [path, operations] of Object.entries(paths)) {
    for (const operation of Object.values(operations)) {
      const responses = (operation.responses ??= {});
      if ((operation.parameters?.length ?? 0) > 0 || operation.requestBody !== undefined) {
        responses['400'] = errorResponse('The input failed its schema: `data.fields` names each field.');
      }
      if (path.startsWith('/lineage/') || path.startsWith('/people/')) {
        responses['404'] = errorResponse('No such person: missing, or not public and not visible to this session (one answer for both).');
      }
    }
  }
  document.components = {
    ...((document.components as Record<string, unknown> | undefined) ?? {}),
    schemas: { Error: ERROR_SCHEMA },
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', description: 'A session token from /api/auth (docs/adr/0004-auth.md).' },
      cookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'wcr.session_token',
        description: 'The web session cookie (named __Secure-wcr.session_token over HTTPS).',
      },
    },
  };
  // Anonymous, bearer or cookie: each procedure checks the session it needs itself.
  document.security = [{}, { bearer: [] }, { cookie: [] }];
  return document;
}

/** The OpenAPI 3.1 document of /api/v1. */
export async function openApiDocument(): Promise<Record<string, unknown>> {
  const generator = new OpenAPIGenerator({ schemaConverters: [new Zod4SchemaConverter()] });
  const document = await generator.generate(router, {
    info: {
      title: 'WingChunRoots API',
      version: '1',
      description:
        'The procedures of /api/v1 (OpenAPI) and /api/rpc (the web client). Lineage reads are public; a signed-in participant (cookie or `Authorization: Bearer`) also sees their own involved_only relationships, marked. See docs/api/lineage.md.',
    },
    servers: [{ url: '/api/v1' }],
  });
  return documentErrors(document as unknown as Record<string, unknown>);
}

/** The file content: two-space JSON with a final newline. */
export async function openApiJson(): Promise<string> {
  return `${JSON.stringify(await openApiDocument(), null, 2)}\n`;
}
