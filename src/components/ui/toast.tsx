'use client';

// Toast (shadcn/ui on Base UI): an ink slip at the bottom, above the phone tab bar and the
// safe area. Toasts are polite status messages; they never carry the only copy of an action
// and stay until dismissed when they hold one (plan §5.6). Wrap the part of a page that toasts
// in ToastProvider; the root layout does not, so pages without toasts do not load this code.

import { Toast as BaseToast } from '@base-ui/react/toast';
import type { ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';

export const useToast = BaseToast.useToastManager;

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider timeout={6000}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed right-4 bottom-[calc(var(--tab-h)+env(safe-area-inset-bottom,0px)+0.75rem)] left-4 z-[60] mx-auto w-auto max-w-[24rem] outline-none md:right-8 md:bottom-8 md:left-auto md:w-[24rem]">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => (
    <BaseToast.Root
      key={toast.id}
      toast={toast}
      className="absolute right-0 bottom-0 left-0 z-[calc(100-var(--toast-index))] w-full origin-bottom rounded-md border border-fg bg-fg text-fg-inverse shadow-pop [transform:translateY(calc(var(--toast-swipe-movement-y)-var(--toast-index)*0.75rem))_scale(calc(1-var(--toast-index)*0.05))] transition-[transform,opacity] duration-(--duration-base) ease-out data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:[transform:translateY(120%)] data-ending-style:[transform:translateY(120%)]"
    >
      <BaseToast.Content className="flex items-start gap-3 py-3 pr-1 pl-4 data-behind:opacity-0">
        <div className="min-w-0 flex-1 pt-1.5">
          <BaseToast.Title className="text-sm font-semibold" />
          <BaseToast.Description className="text-sm" />
        </div>
        <BaseToast.Close aria-label="Dismiss" className="inline-grid size-11 shrink-0 place-items-center rounded-sm hover:bg-fg-muted">
          <CloseIcon size={18} />
        </BaseToast.Close>
      </BaseToast.Content>
    </BaseToast.Root>
  ));
}

