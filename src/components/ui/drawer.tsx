'use client';

// Drawer: the bottom sheet of the phone layout (shadcn/ui pattern on the Base UI Drawer; vaul
// is forbidden). It snaps between a 96 px peek, half height and full height (the peek comes
// from the Transit Map prototype), drags by its whole body, and every drag has a button
// alternative (plan §5.6): "Expand" / "Collapse" and "Close". Back closes it (history layer);
// Esc closes it too. Content scrolls with momentum and contains overscroll (plan §5.8 (b)).

import { Drawer as BaseDrawer } from '@base-ui/react/drawer';
import { useState, type ReactElement, type ReactNode } from 'react';
import { ChevronDownIcon, CloseIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useBackToClose } from './use-back-to-close';

export type SnapPoint = number | string;

/** The peek height: enough for a title line and one row of actions. */
export const PEEK = '96px';
export const SHEET_SNAP_POINTS: SnapPoint[] = [PEEK, 0.5, 1];

export interface DrawerProps {
  /** The element that opens the sheet. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  /** One line under the title; visible at the peek. */
  description?: ReactNode;
  children?: ReactNode;
  /** Snap points; the first one is where the sheet opens. */
  snapPoints?: SnapPoint[];
  /**
   * A modal sheet dims the page and traps focus; a non-modal one (a peek over a map or a
   * graph) leaves the page usable behind it.
   */
  modal?: boolean;
  className?: string;
}

export function Drawer({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  children,
  snapPoints = SHEET_SNAP_POINTS,
  modal = true,
  className,
}: DrawerProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const first = snapPoints[0] ?? 1;
  const [snapPoint, setSnapPoint] = useState<SnapPoint | null>(first);
  // Every opening starts at the first snap point, however the sheet was closed before (Close,
  // Esc, Back) and whoever opens it (the trigger or a controlling parent).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSnapPoint(first);
  }
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  useBackToClose(open, () => setOpen(false));

  const last = snapPoints[snapPoints.length - 1] ?? 1;
  const expanded = snapPoint === last;

  return (
    <BaseDrawer.Root
      open={open}
      onOpenChange={setOpen}
      snapPoints={snapPoints}
      snapPoint={snapPoint}
      onSnapPointChange={setSnapPoint}
      modal={modal}
      disablePointerDismissal={!modal}
    >
      {trigger ? <BaseDrawer.Trigger render={trigger} /> : null}
      <BaseDrawer.Portal>
        {modal ? (
          <BaseDrawer.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-scrim opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--duration-slow) ease-out data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        ) : null}
        <BaseDrawer.Viewport
          className={cn(
            'fixed inset-0 z-50 flex items-end justify-center',
            // A non-modal sheet lets taps through to the page around it.
            !modal && 'pointer-events-none',
          )}
        >
          <BaseDrawer.Popup
            className={cn(
              'pointer-events-auto relative flex max-h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem)] w-full max-w-[40rem] min-h-0 flex-col',
              'rounded-t-sheet border border-b-0 border-border-subtle bg-surface-2 text-fg shadow-sheet outline-none touch-none',
              '[transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]',
              'transition-transform duration-(--duration-slow) ease-out data-swiping:duration-0 data-swiping:select-none',
              'data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]',
              className,
            )}
          >
            <div className="shrink-0 px-4 pt-2 pb-3 select-none sm:px-6">
              <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong" />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 pt-1">
                  <BaseDrawer.Title className="truncate font-display text-xl leading-tight text-fg">{title}</BaseDrawer.Title>
                  {description ? (
                    <BaseDrawer.Description className="mt-0.5 truncate text-sm text-fg-muted">{description}</BaseDrawer.Description>
                  ) : null}
                </div>
                {snapPoints.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setSnapPoint(expanded ? first : last)}
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                    className="inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
                  >
                    <ChevronDownIcon size={20} className={cn('transition-transform duration-(--duration-fast)', !expanded && 'rotate-180')} />
                  </button>
                ) : null}
                <BaseDrawer.Close
                  aria-label="Close"
                  className="inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
                >
                  <CloseIcon size={20} />
                </BaseDrawer.Close>
              </div>
            </div>
            <BaseDrawer.Content className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:px-6">
              {children}
            </BaseDrawer.Content>
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
