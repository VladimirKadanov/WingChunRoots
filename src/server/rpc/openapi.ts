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
    markFiles(json);
    // Optional when undefined is a valid value (an optional or defaulted field, an empty body).
    const required = !zod.safeParse(undefined).success;
    return [required, json as JSONSchema];
  }
}

/**
 * M14: a z.file() field (photos.upload) becomes `{ type: string, format: binary }`; oRPC documents a
 * body as multipart/form-data only when a field has `contentMediaType`, so it gets one.
 */
function markFiles(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) markFiles(item);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.type === 'string' && record.format === 'binary' && record.contentMediaType === undefined) {
    record.contentMediaType = 'application/octet-stream';
    delete record.contentEncoding;
  }
  for (const value of Object.values(record)) markFiles(value);
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
  const components = (document.components as Record<string, Record<string, unknown> | undefined> | undefined) ?? {};
  document.components = {
    ...components,
    // Added to what the generator put there (a schema registered with an id is $ref'd from it).
    schemas: { ...(components.schemas ?? {}), Error: ERROR_SCHEMA },
    securitySchemes: {
      ...(components.securitySchemes ?? {}),
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

/**
 * M10a: the two binary route handlers of evidence files, outside the router (a file is the body of
 * the upload and of the download, never JSON), served under /api rather than /api/v1: each path
 * names its own server. A native client uploads and opens evidence through these, with the same
 * session (cookie or bearer) and the same checks as the web (src/server/evidence-http.ts).
 */
export function documentEvidence(document: Record<string, unknown>): Record<string, unknown> {
  const errors = (codes: Record<string, string>) => Object.fromEntries(Object.entries(codes).map(([code, description]) => [code, errorResponse(description)]));
  document.paths = {
    ...((document.paths ?? {}) as Record<string, unknown>),
    '/evidence/upload': {
      servers: [{ url: '/api' }],
      post: {
        operationId: 'evidence.upload',
        summary: 'Upload one evidence file (JPEG, PNG, WebP or PDF, at most 20 MB): private, never public; images are re-encoded without metadata',
        parameters: [
          { name: 'case', in: 'query', required: false, description: 'An open claim of the uploader to add the file to; without it the file waits for a claim.', schema: { type: 'string', format: 'uuid' } },
          { name: 'X-File-Name', in: 'header', required: false, description: "The file's own name, URI-encoded.", schema: { type: 'string', maxLength: 1000 } },
          { name: 'Content-Length', in: 'header', required: true, description: 'The size of the file; refused above 20 MB before the body is read.', schema: { type: 'integer', minimum: 1, maximum: 20971520 } },
        ],
        requestBody: { required: true, content: { 'application/octet-stream': { schema: { type: 'string', contentMediaType: 'application/octet-stream' } } } },
        responses: {
          '201': {
            description: "The stored file: its id, type, size, both hashes and the app's download address (never a storage address).",
            content: { 'application/json': { schema: { type: 'object', required: ['evidence'], properties: { evidence: { type: 'object' } } } } },
          },
          ...errors({
            '400': 'An empty file, or one that ended before its Content-Length.',
            '401': 'No session.',
            '403': 'A cross-site request with a cookie session.',
            '404': 'No such open claim of yours.',
            '409': 'The claim has 20 files, or has been decided.',
            '411': 'No Content-Length.',
            '413': 'Larger than 20 MB.',
            '415': 'Not a JPEG, PNG, WebP or PDF by its magic bytes, or an image that cannot be read.',
            '429': '20 files not yet in a claim were uploaded in 24 hours.',
          }),
        },
      },
    },
    '/evidence/{id}': {
      servers: [{ url: '/api' }],
      get: {
        operationId: 'evidence.download',
        summary: 'Download an evidence file: the uploader, the teacher of the request, the assigned reviewers and the administrators; 404 for anyone else',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'The file, as an attachment (Content-Disposition: attachment, Cache-Control: no-store, X-Content-Type-Options: nosniff).',
            content: { 'application/octet-stream': { schema: { type: 'string', contentMediaType: 'application/octet-stream' } } },
          },
          ...errors({ '404': 'No such file, or not one this session may open (one answer for both).' }),
        },
      },
    },
  };
  return document;
}

/**
 * M14: the binary route handler of profile photos, outside the router (the answer is the image),
 * under /api: one rendition of a person's current photo after the visibility check
 * (src/server/photo-http.ts). The upload and the removal are procedures (photos.upload, photos.remove).
 */
export function documentPhotos(document: Record<string, unknown>): Record<string, unknown> {
  document.paths = {
    ...((document.paths ?? {}) as Record<string, unknown>),
    '/photos/{id}/{hash}/{file}': {
      servers: [{ url: '/api' }],
      get: {
        operationId: 'photos.image',
        summary:
          "One rendition of a person's current profile photo (WebP, square, no metadata): everyone for a public person; for a person who is not public only the person's own account and staff; 404 otherwise",
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'The photo id (photos.get, or `photo` on a person in any public answer).', schema: { type: 'string', format: 'uuid' } },
          { name: 'hash', in: 'path', required: true, description: "The first 16 hex digits of the photo's content hash.", schema: { type: 'string', pattern: '^[0-9a-f]{16}$' } },
          { name: 'file', in: 'path', required: true, description: 'The size: the 96 px card thumbnail or the 512 px profile image.', schema: { type: 'string', enum: ['96.webp', '512.webp'] } },
        ],
        responses: {
          '200': {
            description: 'The image (Content-Type: image/webp; ETag: the content hash; Cache-Control: public, no-cache (revalidated with the ETag) for a public person, private, no-store otherwise).',
            content: { 'image/webp': { schema: { type: 'string', contentMediaType: 'image/webp' } } },
          },
          '304': { description: 'Not modified (If-None-Match matched the ETag).' },
          '404': errorResponse('No such photo, a replaced or removed one, or a person this session may not see (one answer for all).'),
          '503': errorResponse('The photo store did not deliver the image in time (5 s) or failed; Cache-Control: no-store. Try again later.'),
        },
      },
    },
  };
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
  return documentPhotos(documentEvidence(documentErrors(document as unknown as Record<string, unknown>)));
}

/** The file content: two-space JSON with a final newline. */
export async function openApiJson(): Promise<string> {
  return `${JSON.stringify(await openApiDocument(), null, 2)}\n`;
}
