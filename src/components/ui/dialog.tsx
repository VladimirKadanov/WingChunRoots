'use client';

// Dialog (shadcn/ui on Base UI): centred on desktop, full-width near the bottom on phones, its
// title in the display face over a rule. Back closes it (history layer). Opening and closing fade within 200 ms; instant under
// prefers-reduced-motion.

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useState, type ReactElement, type ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useBackToClose } from './use-back-to-close';

export interface DialogProps {
  /** The element that opens the dialog, e.g. <Button>Open</Button>; none for a dialog its parent opens (`open`). */
  trigger?: ReactElement;
  /** Controlled: whether the dialog is open (the parent opens it, e.g. from a key). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons at the bottom; a Close button is always in the corner. */
  footer?: ReactNode;
  className?: string;
}

export function Dialog({ trigger, open: openProp, onOpenChange, title, description, children, footer, className }: DialogProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  useBackToClose(open, () => setOpen(false));
  return (
    <BaseDialog.Root open={open} onOpenChange={setOpen}>
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-(--duration-base) ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        {/* The viewport scrolls when the dialog is taller than the window (a short landscape
            phone, 200 % text), and keeps clear of the safe area on every side. */}
        <BaseDialog.Viewport className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto overscroll-contain pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
          <BaseDialog.Popup
            className={cn(
              // mt-auto: at the bottom on phones; my-auto from 640 px: centred. Either way it
              // overflows downwards, where the viewport scrolls.
              'relative mt-auto w-full max-w-[30rem] shrink-0 rounded-lg border border-border-subtle bg-surface-2 p-6 text-fg shadow-pop outline-none [--seal-ground:var(--surface-2)] sm:mb-auto',
              'transition-[opacity,transform] duration-(--duration-base) ease-out',
              'data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0',
              className,
            )}
          >
            <BaseDialog.Title className="border-b border-border-subtle pr-10 pb-3 font-display text-2xl text-fg">{title}</BaseDialog.Title>
            {description ? (
              <BaseDialog.Description className="mt-3 text-base text-fg-muted">{description}</BaseDialog.Description>
            ) : null}
            {children ? <div className="mt-4">{children}</div> : null}
            {footer ? <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div> : null}
            <BaseDialog.Close
              aria-label="Close"
              className="absolute top-3 right-3 inline-grid size-11 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg active:bg-surface-pressed"
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
