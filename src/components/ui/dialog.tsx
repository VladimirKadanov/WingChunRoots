'use client';

// Dialog (shadcn/ui on Base UI): centred on desktop, full-width near the bottom on phones.
// Back closes it (history layer). Opening and closing fade within 200 ms; instant under
// prefers-reduced-motion.

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useState, type ReactElement, type ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useBackToClose } from './use-back-to-close';

export interface DialogProps {
  /** The element that opens the dialog, e.g. <Button>Open</Button>. */
  trigger: ReactElement;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons at the bottom; a Close button is always in the corner. */
  footer?: ReactNode;
  className?: string;
}

export function Dialog({ trigger, title, description, children, footer, className }: DialogProps) {
  const [open, setOpen] = useState(false);
  useBackToClose(open, () => setOpen(false));
  return (
    <BaseDialog.Root open={open} onOpenChange={setOpen}>
      <BaseDialog.Trigger render={trigger} />
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-(--duration-base) ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-[max(1rem,env(safe-area-inset-bottom))_1rem] sm:items-center">
          <BaseDialog.Popup
            className={cn(
              'relative w-full max-w-[30rem] rounded-lg border border-border-subtle bg-surface-2 p-6 pr-14 text-fg shadow-pop outline-none',
              'transition-[opacity,transform] duration-(--duration-base) ease-out',
              'data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0',
              className,
            )}
          >
            <BaseDialog.Title className="font-display text-xl text-fg">{title}</BaseDialog.Title>
            {description ? (
              <BaseDialog.Description className="mt-2 text-sm text-fg-muted">{description}</BaseDialog.Description>
            ) : null}
            {children ? <div className="mt-4">{children}</div> : null}
            {footer ? <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div> : null}
            <BaseDialog.Close
              aria-label="Close"
              className="absolute top-2 right-2 inline-grid size-11 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              <CloseIcon size={20} />
            </BaseDialog.Close>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export const DialogClose = BaseDialog.Close;
