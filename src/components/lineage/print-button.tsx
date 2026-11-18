'use client';

// "Print or save as PDF" (ADR 0045): opens the browser's print dialog, where "Save as PDF" makes
// the PDF. No PDF library. The page says beside it how to do the same with the browser's own
// Print, which also works without JavaScript.

import { buttonVariants } from '@/components/ui/button-variants';

export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonVariants({ variant: 'primary' })} data-testid="print-card">
      {label}
    </button>
  );
}
