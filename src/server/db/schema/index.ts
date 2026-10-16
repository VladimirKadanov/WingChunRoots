// The Drizzle schema of Phase 1 (plan §6.2), without the Better Auth tables (M02) and without
// media_asset (Phase 2). drizzle.config.ts points drizzle-kit at this file.

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
