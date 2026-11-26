'use client';

// The city type-ahead, loaded after hydration (role replay 2026-11-25, P2-12): a form's first
// JavaScript keeps only its select of the large cities, which stays on the page (the `fallback`)
// until the type-ahead's module arrives, and without JavaScript. React.lazy as for the pin picker
// (src/app/dashboard/schools/school-form.tsx): the route budget (ADR 0014).

import { type ComponentProps, lazy, type ReactNode, Suspense } from 'react';

import { useHydrated } from './fields';

const CityField = lazy(() => import('./city-field').then((m) => ({ default: m.CityField })));

export function LazyCityField({ fallback, ...props }: ComponentProps<typeof CityField> & { fallback: ReactNode }) {
  const hydrated = useHydrated();
  if (!hydrated) return fallback;
  return (
    <Suspense fallback={fallback}>
      <CityField {...props} />
    </Suspense>
  );
}
