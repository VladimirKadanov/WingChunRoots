'use client';

// "Show on a map" of the school heatmap (milestone M24): loads the MapLibre island
// (src/components/map/heatmap-map.tsx) only when the admin asks for it, so the page's first
// JavaScript carries no map code (scripts/check-bundle-budget.mjs). The table on the page has the
// same numbers; the map adds nothing a reader without it misses.

import { lazy, Suspense, useState } from 'react';

import { buttonVariants } from '@/components/ui/button-variants';
import type { HeatSquare } from '@/components/map/heatmap-map';

const HeatmapMap = lazy(() => import('@/components/map/heatmap-map'));

export function HeatmapView({ cells, styles }: { cells: readonly HeatSquare[]; styles: { light: string; dark: string } }) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <p>
        <button type="button" className={buttonVariants({ variant: 'secondary', size: 'lg' })} onClick={() => setShown(true)} data-testid="organization-heatmap-show">
          Show on a map
        </button>
      </p>
    );
  }
  return (
    <Suspense fallback={<p className="text-ui text-fg-muted" role="status">Loading the map…</p>}>
      <HeatmapMap cells={cells} styles={styles} />
    </Suspense>
  );
}
