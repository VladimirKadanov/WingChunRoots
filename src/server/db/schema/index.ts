// The Drizzle schema of Phase 1 (plan §6.2), with the Better Auth tables of M02 (auth_*) and
// without media_asset (Phase 2). drizzle.config.ts points drizzle-kit at this file.

export * from './auth';
export * from './common';
export * from './entitlements';
export * from './evidence';
export * from './geography';
export * from './lineage';
export * from './organizations';
export * from './persons';
export * from './records';
export * from './schools';
export * from './views';
