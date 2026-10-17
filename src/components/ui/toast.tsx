'use client';

// Toast (shadcn/ui on Base UI): a paper slip at the bottom, above the phone tab bar and the
// safe area, with a rule on its left edge in the colour of its kind and, for a link state, that
// state's seal (the kind is also in the words). Toasts are polite status messages; they never
// carry the only copy of an action (plan §5.6). They stay 10 s, pause while hovered or focused,
// and Dismiss closes them at once. Wrap the part of a page that toasts in ToastProvider; the root
// layout does not, so pages without toasts do not load this code.

import { Toast as BaseToast } from '@base-ui/react/toast';
import type { ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import { Seal } from '@/components/ink/seal';
import { cx } from '@/lib/cx';

export const useToast = BaseToast.useToastManager;

/** The `type` of toast.add(): a link state, or plain information (the default). */
export type ToastKind = 'verified' | 'under_review' | 'info';

const RULE: Record<ToastKind, string> = {
  verified: 'before:bg-verified',
  under_review: 'before:bg-review',
  info: 'before:bg-fg',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider timeout={10000}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed right-[max(1rem,env(safe-area-inset-right,0px))] bottom-[calc(var(--tab-h)+env(safe-area-inset-bottom,0px)+0.75rem)] left-[max(1rem,env(safe-area-inset-left,0px))] z-[60] mx-auto w-auto max-w-[24rem] outline-none md:right-[max(2rem,env(safe-area-inset-right,0px))] md:bottom-[max(2rem,env(safe-area-inset-bottom,0px))] md:left-auto md:w-[24rem]">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => {
    const kind: ToastKind = toast.type === 'verified' || toast.type === 'under_review' ? toast.type : 'info';
    return (
      <BaseToast.Root
        key={toast.id}
        toast={toast}
        className={cx(
          'absolute right-0 bottom-0 left-0 z-[calc(100-var(--toast-index))] w-full origin-bottom overflow-hidden rounded-md border border-border-strong bg-surface-2 text-fg shadow-pop',
          'before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
          RULE[kind],
          '[transform:translateY(calc(var(--toast-swipe-movement-y)-var(--toast-index)*0.75rem))_scale(calc(1-var(--toast-index)*0.05))] transition-[transform,opacity] duration-(--duration-base) ease-out',
          'data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:[transform:translateY(120%)] data-ending-style:[transform:translateY(120%)]',
        )}
      >
        <BaseToast.Content className="flex items-start gap-3 py-3 pr-1 pl-4 data-behind:opacity-0">
          {kind !== 'info' ? <Seal kind={kind === 'verified' ? 'check' : 'hourglass'} size={22} className="mt-1.5" /> : null}
          <div className="min-w-0 flex-1 pt-1.5">
            <BaseToast.Title className="text-ui font-semibold" />
            <BaseToast.Description className="text-sm text-fg-muted" />
          </div>
          <BaseToast.Close
            aria-label="Dismiss"
            className="inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg active:bg-surface-pressed"
          >
            <CloseIcon size={18} />
          </BaseToast.Close>
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}
