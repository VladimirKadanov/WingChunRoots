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
  return document as unknown as Record<string, unknown>;
}

/** The file content: two-space JSON with a final newline. */
export async function openApiJson(): Promise<string> {
  return `${JSON.stringify(await openApiDocument(), null, 2)}\n`;
}
