// "Start answering as a Sifu" (journey review 2026-11-26, P1-1): one button for a Student account
// that has student requests waiting. A plain form posted to a Server Action, so it works without
// JavaScript; the action is passed in, so this file stays free of server imports.

import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';

export function StartAsSifu({ action, waiting, testId }: { action: () => Promise<void>; waiting: number; testId: string }) {
  return (
    <div data-testid={testId} className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
      <p className="max-w-[60ch] text-ui">
        {waiting === 1 ? 'A student is waiting for you to confirm that you taught them.' : `${waiting} students are waiting for you to confirm that you taught them.`} Your account is a
        Student account; answering needs a Sifu account, which is free and keeps your own teachers as they are.
      </p>
      <form action={action}>
        <button type="submit" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          Start answering as a Sifu
          <ArrowRightIcon />
        </button>
      </form>
    </div>
  );
}
