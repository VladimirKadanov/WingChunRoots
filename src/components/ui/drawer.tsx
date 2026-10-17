'use client';

// Drawer (shadcn/ui pattern on the Base UI Drawer; vaul is forbidden). On phones it is a bottom
// sheet that snaps between heights and drags by its whole body; from 768 px it is a side panel,
// var(--sheet-w) wide, on the right. Every drag has a button alternative (plan §5.6): "Expand" /
// "Collapse" and "Close". Back closes it (history layer); Esc closes it too. Content scrolls
// with momentum and contains overscroll (plan §5.8 (b)).
//
// A modal sheet opens at half height, so the scrim above it shows that the page waits. A
// non-modal one (over a map or a graph) opens at the peek from the Transit Map prototype: at
// least PEEK tall and never shorter than its own header, so a title that wraps at 150 % text
// still shows whole. It rests on the phone tab bar, which keeps the home indicator's inset, and
// is clipped there, so the tabs stay visible and tappable. Its body is inert while it peeks, so
// the keyboard never reaches content that is off screen. Below full height, a keyboard focus
// that lands under the bottom edge expands the sheet first (WCAG 2.4.11).
//
// While a sheet is open it publishes how much room it takes on <html>: --sheet-clear (phone:
// px from the bottom of the window to the sheet's top edge at its snap point) and --sheet-inline
// (from 768 px: the side panel's width), so toasts land beside the sheet instead of on it. With
// two sheets open, the newer one's room is published, and the older one's again when it closes.
// The room follows the snap point, not a drag in progress (that would restyle the page on every
// frame); it catches up when the drag settles.

import { Drawer as BaseDrawer } from '@base-ui/react/drawer';
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactElement, type ReactNode } from 'react';
import { ChevronDownIcon, CloseIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useBackToClose } from './use-back-to-close';
import { useMediaQuery } from './use-media-query';

export type SnapPoint = number | string;

/** The smallest peek: a title line and one row of actions. */
export const PEEK = '96px';
const PEEK_PX = 96;
/** Where a modal sheet can rest: half height and full height. */
export const MODAL_SNAP_POINTS: SnapPoint[] = [0.5, 1];
/** Where a non-modal sheet can rest: the peek, half height and full height. */
export const PEEK_SNAP_POINTS: SnapPoint[] = [PEEK, 0.5, 1];
/** From this width the sheet is a side panel (the md breakpoint). */
const SIDE_PANEL = '(min-width: 48rem)';

export interface DrawerProps {
  /** The element that opens the sheet. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  /** A line under the title, visible at the peek. */
  description?: ReactNode;
  children?: ReactNode;
  /** Phone snap points; the first one is where the sheet opens. PEEK stands for the measured peek. */
  snapPoints?: SnapPoint[];
  /**
   * A modal sheet dims the page and traps focus; a non-modal one (a peek over a map or a
   * graph) leaves the page usable behind it.
   */
  modal?: boolean;
  className?: string;
}

const iconButton =
  'inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg active:bg-surface-pressed';

export function Drawer({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  children,
  snapPoints: snapPointsProp,
  modal = true,
  className,
}: DrawerProps) {
  const side = useMediaQuery(SIDE_PANEL);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;

  // The peek follows the header (handle, title, description and the 1 px top border).
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    if (!header || typeof ResizeObserver !== 'function') return;
    const update = () => setHeaderHeight(Math.ceil(header.getBoundingClientRect().height) + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, [header]);
  const peek = `${Math.max(PEEK_PX, headerHeight)}px`;
  const snapPoints = side
    ? undefined
    : (snapPointsProp ?? (modal ? MODAL_SNAP_POINTS : PEEK_SNAP_POINTS)).map((point) => (point === PEEK ? peek : point));
  const lastIndex = snapPoints ? snapPoints.length - 1 : 0;
  const peekIndex = snapPointsProp ? snapPointsProp.indexOf(PEEK) : modal ? -1 : 0;

  // The sheet rests at a snap point by index, so a peek that grows with the text stays the peek.
  const [snapIndex, setSnapIndex] = useState(0);
  // Every opening starts at the first snap point, however the sheet was closed before (Close,
  // Esc, Back) and whoever opens it (the trigger or a controlling parent).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSnapIndex(0);
  }
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  useBackToClose(open, () => setOpen(false));

  const expanded = snapIndex === lastIndex;
  const peeking = !side && snapIndex === peekIndex;

  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  useSheetRoom(open, side, viewport, popup);

  // Below full height the lower part of the sheet is off screen. A focus that lands there (Tab,
  // or a script restoring focus) expands the sheet first, so the focused control is never hidden
  // (WCAG 2.4.11). "There" means the control's first 48 px (or all of it, when shorter) do not
  // fit above the bottom edge, so a tall focusable region whose top shows does not expand it.
  // A focus that comes with a press of a finger or a mouse is left alone: moving the sheet in
  // the middle of a tap on a control that peeks over the edge would lose the tap.
  const pressedAt = useRef(Number.NEGATIVE_INFINITY);
  const onContentFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (side || expanded || !viewport || event.timeStamp - pressedAt.current < 1000) return;
    const box = event.target.getBoundingClientRect();
    if (Math.min(box.bottom, box.top + 48) > viewport.getBoundingClientRect().bottom - 1) setSnapIndex(lastIndex);
  };

  return (
    <BaseDrawer.Root
      open={open}
      onOpenChange={setOpen}
      swipeDirection={side ? 'right' : 'down'}
      snapPoints={snapPoints}
      snapPoint={snapPoints ? snapPoints[Math.min(snapIndex, lastIndex)] : undefined}
      onSnapPointChange={(point) => {
        const index = point === null || !snapPoints ? -1 : snapPoints.indexOf(point);
        if (index >= 0) setSnapIndex(index);
      }}
      modal={modal}
      disablePointerDismissal={!modal}
    >
      {trigger ? <BaseDrawer.Trigger render={trigger} /> : null}
      <BaseDrawer.Portal>
        {modal ? (
          // A steady scrim at every snap point. Base UI's --drawer-swipe-progress counts from the
          // highest snap point, so it reads 1 at half height and would hide the scrim there.
          <BaseDrawer.Backdrop
            data-drawer-backdrop=""
            className="fixed inset-0 z-50 min-h-dvh bg-scrim transition-opacity duration-(--duration-slow) ease-out data-ending-style:opacity-0 data-starting-style:opacity-0"
          />
        ) : null}
        <BaseDrawer.Viewport
          ref={setViewport}
          className={cn(
            'fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end',
            // A non-modal sheet lets taps through to the page around it. On phones it rests on the
            // tab bar, which keeps the bottom safe-area inset, and the viewport clips the part of
            // the popup that its snap point moves below that edge: the tabs stay seen and tappable.
            !modal && 'pointer-events-none bottom-[calc(var(--tab-h)+env(safe-area-inset-bottom,0px))] max-md:overflow-hidden md:bottom-0',
          )}
        >
          <BaseDrawer.Popup
            ref={setPopup}
            className={cn(
              'pointer-events-auto relative flex min-h-0 w-full flex-col border-border-subtle bg-surface-2 text-fg shadow-sheet outline-none',
              // Phone: a bottom sheet, never taller than its viewport (above the tab bar when non-modal).
              'max-h-[calc(100%-env(safe-area-inset-top,0px)-0.75rem)] max-w-[40rem] touch-none rounded-t-sheet border border-b-0',
              '[transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]',
              'data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]',
              // From 768 px: a side panel on the right, the full height of the window.
              'md:h-full md:max-h-none md:w-sheet md:max-w-[calc(100vw-4rem)] md:rounded-none md:border-0 md:border-l',
              'md:[transform:translateX(var(--drawer-swipe-movement-x,0px))]',
              'md:data-starting-style:[transform:translateX(100%)] md:data-ending-style:[transform:translateX(100%)]',
              'transition-transform duration-(--duration-slow) ease-out data-swiping:duration-0 data-swiping:select-none',
              className,
            )}
          >
            <div
              ref={setHeader}
              className="shrink-0 px-4 pt-2 pb-3 select-none sm:px-6 md:pt-[max(1rem,env(safe-area-inset-top,0px))] md:pr-[max(1rem,env(safe-area-inset-right,0px))]"
            >
              <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong md:hidden" />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 pt-1">
                  {/* line-clamp clips to the line boxes: leading-tight (1.25) holds Gloock's 1.2 em
                      ascent and descent, so no descender is cut (WebKit counts it as overflow). */}
                  <BaseDrawer.Title className="line-clamp-2 font-display text-xl leading-tight text-fg [overflow-wrap:anywhere]">
                    {title}
                  </BaseDrawer.Title>
                  {description ? <BaseDrawer.Description className="mt-0.5 text-sm text-fg-muted">{description}</BaseDrawer.Description> : null}
                </div>
                {snapPoints && snapPoints.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setSnapIndex(expanded ? 0 : lastIndex)}
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                    className={iconButton}
                  >
                    <ChevronDownIcon size={20} className={cn('transition-transform duration-(--duration-fast)', !expanded && 'rotate-180')} />
                  </button>
                ) : null}
                <BaseDrawer.Close aria-label="Close" className={iconButton}>
                  <CloseIcon size={20} />
                </BaseDrawer.Close>
              </div>
            </div>
            <BaseDrawer.Content
              inert={peeking}
              onPointerDown={(event) => {
                pressedAt.current = event.timeStamp;
              }}
              onFocus={onContentFocus}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:px-6 md:pr-[max(1.5rem,env(safe-area-inset-right,0px))]"
            >
              {children}
            </BaseDrawer.Content>
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}

interface Room {
  clear: string | null;
  inline: string | null;
}

/** The room of every open sheet, in the order they opened (see the top of this file). */
const rooms = new Map<symbol, Room>();

/** Writes the newest open sheet's room on <html>, or removes it when no sheet is open. */
function publishRooms() {
  const root = document.documentElement.style;
  const newest = [...rooms.values()].at(-1);
  for (const [name, value] of [
    ['--sheet-clear', newest?.clear],
    ['--sheet-inline', newest?.inline],
  ] as const) {
    if (value) root.setProperty(name, value);
    else root.removeProperty(name);
  }
}

/**
 * Publishes the room an open sheet takes. The snap offset comes from the popup's inline style
 * (Base UI), so the page is restyled only when the snap point or a size changes.
 */
function useSheetRoom(open: boolean, side: boolean, viewport: HTMLElement | null, popup: HTMLElement | null) {
  useEffect(() => {
    if (!open || !viewport || !popup) return;
    const key = Symbol('sheet');
    let offset: string | null = null;
    const measure = (force: boolean) => {
      if (side) {
        rooms.set(key, { clear: null, inline: `${popup.offsetWidth}px` });
        publishRooms();
        return;
      }
      const next = popup.style.getPropertyValue('--drawer-snap-point-offset');
      if (!force && next === offset) return;
      offset = next;
      const visible = Math.max(0, popup.offsetHeight - (Number.parseFloat(next) || 0));
      const clear = window.innerHeight - viewport.getBoundingClientRect().bottom + visible;
      rooms.set(key, { clear: `${Math.round(clear)}px`, inline: null });
      publishRooms();
    };
    measure(true);
    const styles = new MutationObserver(() => measure(false));
    styles.observe(popup, { attributes: true, attributeFilter: ['style'] });
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure(true)) : null;
    sizes?.observe(popup);
    sizes?.observe(viewport);
    return () => {
      styles.disconnect();
      sizes?.disconnect();
      rooms.delete(key);
      publishRooms();
    };
  }, [open, side, viewport, popup]);
}
