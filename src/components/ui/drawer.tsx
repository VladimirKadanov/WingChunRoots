'use client';

// Drawer (shadcn/ui pattern on the Base UI Drawer; vaul is forbidden). Below 1024 px it is a
// bottom sheet that snaps between heights and drags by its whole body (from 768 px over the page,
// right of the rail); from 1024 px it is a side panel, var(--sheet-w) wide, on the right. Every
// drag has a button alternative (plan §5.6): "Expand" / "Collapse" and "Close". Back closes it
// (history layer); Esc closes it too. Content scrolls with momentum and contains overscroll
// (plan §5.8 (b)). A long title wraps; it is never cut (plan §5.3).
//
// A modal sheet opens at half height, so the scrim above it shows that the page waits. A
// non-modal one (over a map or a graph) opens at the peek from the Transit Map prototype: at
// least PEEK tall and never shorter than its own header, so a title that wraps at 150 % text
// still shows whole. It rests on the phone tab bar, which keeps the home indicator's inset, and
// is clipped there (overflow: clip, which never scrolls), so the tabs stay visible and tappable.
// Its body is inert while it peeks, so the keyboard never reaches content that is off screen.
// A fraction as its first snap point (the explorer's 0.15) is floored at that peek, and is the peek.
// Below full height, a keyboard focus that lands under the bottom edge expands the sheet first
// (WCAG 2.4.11).
//
// While a sheet is open it publishes how much room it takes on <html> (globals.css reads it):
// - --sheet-clear: px from the bottom of the window to the top edge of a bottom sheet at its snap
//   point, and --sheet-inline: the side panel's width. Toasts land above or beside the sheet.
// - --sheet-head and data-sheet-full: a bottom sheet that leaves less than 9rem above it, with
//   more room under its header than above it, is "full"; toasts then sit under its header, clear
//   of its title and its buttons.
// - --sheet-page-clear and --sheet-page-inline, for a non-modal sheet only (the page behind it is
//   live): the page keeps that room clear, so focus never lands on a control under the sheet
//   (WCAG 2.4.11). From 1024 px the page narrows beside the side panel. A bottom sheet that leaves
//   less than 9rem of the page above it keeps no room: the page is behind it whatever its padding,
//   and a screen of padding would only make the page jump when the sheet comes down again. Nor
//   does one that leaves the page less than its caller's `coverAbove` (a page whose own content
//   needs that room to be of use: the explorer's canvas): it covers that page as it is.
// With two sheets open, the newer one's room is published (for the page: the newer non-modal
// one's), and the older one's again when it closes. The room follows the snap point, not a drag
// in progress (that would restyle the page on every frame); it catches up when the drag settles.

import { Drawer as BaseDrawer } from '@base-ui/react/drawer';
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
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
/** From this width the sheet is a side panel (the lg breakpoint). */
const SIDE_PANEL = '(min-width: 64rem)';

/** Why the sheet opens or closes (Base UI's event details); `cancel()` keeps it as it is. */
export type DrawerChangeDetails = Parameters<NonNullable<ComponentProps<typeof BaseDrawer.Root>['onOpenChange']>>[1];

/** What a caller can do to an open sheet (milestone M06: Esc in the explorer's graph). */
export interface DrawerActions {
  /** Lowers a bottom sheet above its first snap point to it; false when it was not above it (or is closed, or a side panel). */
  collapse(): boolean;
}

export interface DrawerProps {
  /** The element that opens the sheet. */
  trigger?: ReactElement;
  open?: boolean;
  /** The sheet opens or closes; without `details` when Back closed it (the history layer). */
  onOpenChange?: (open: boolean, details?: DrawerChangeDetails) => void;
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
  // Pass-throughs (milestone M06: the explorer's sheet).
  /** Where focus goes when the sheet opens (Base UI Popup); `false` leaves it where it is. */
  initialFocus?: ComponentProps<typeof BaseDrawer.Popup>['initialFocus'];
  /** Where focus goes when the sheet closes (Base UI Popup); `false` leaves it where it is. */
  finalFocus?: ComponentProps<typeof BaseDrawer.Popup>['finalFocus'];
  /** The sheet came to rest at another snap point (by a drag, a button or a new opening): its value as given and its index. */
  onSnapPointChange?: (point: SnapPoint, index: number) => void;
  /** A row of actions in the header, under the title: always in view, at the peek too (the peek grows with it). */
  headerActions?: ReactNode;
  /** Keeps the sheet's elements mounted while it is closed (Base UI Portal). */
  keepMounted?: boolean;
  /** Data attributes for the popup (the sheet's element), such as a test id. */
  popupAttributes?: { [name: `data-${string}`]: string | undefined };
  /** The sheet's actions (DrawerActions). */
  actions?: Ref<DrawerActions>;
  /**
   * A non-modal bottom sheet: how far down the window (px from its top) the page must still show
   * above the sheet at a middle snap point (one between the first and the last), the room the
   * sheet publishes for the page included. A middle point that would rest higher is lowered to
   * that, never below the first one (milestone M06: the explorer's legend and selected card stay
   * in view above a short phone's sheet). The last point is never lowered: there the sheet covers.
   */
  keepAbove?: number | null;
  /**
   * A non-modal bottom sheet: how far down the window (px from its top) the page must still show
   * above the sheet, the room the sheet publishes for it included, for that room to be of use. A
   * sheet resting higher (its first snap point, which is never lowered, in a short window) covers
   * the page as at its last snap point: it publishes no room, and the page keeps its size behind
   * it (milestone M06, a11y-6: below 768 px with 200 % zoom the explorer's canvas shrank to 0 px
   * over the peek). Never more than `keepAbove`, so a middle point lowered for that one keeps room.
   */
  coverAbove?: number | null;
}

// 44 px, not 2.75rem: at 150 % text two rem-sized buttons took 132 px from the title's column.
const iconButton =
  'inline-grid size-[44px] shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg active:bg-surface-pressed';

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
  initialFocus,
  finalFocus,
  onSnapPointChange,
  headerActions,
  keepMounted,
  popupAttributes,
  actions,
  keepAbove = null,
  coverAbove = null,
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
  const peekPx = Math.max(PEEK_PX, headerHeight);
  const peek = `${peekPx}px`;
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  // A non-modal sheet's first snap point given as a fraction of the viewport (the explorer's 0.15)
  // is the peek: never shorter than the measured peek, and inert as the peek is. Base UI reads a
  // fraction against its viewport element, measured here; the window until it is there.
  const viewportHeight = useHeight(viewport);
  const given = snapPointsProp ?? (modal ? MODAL_SNAP_POINTS : PEEK_SNAP_POINTS);
  const fractionPeek = !modal && typeof given[0] === 'number' && given[0] <= 1 && !given.includes(PEEK);
  const snapPoints = side
    ? undefined
    : given.map((point, index) => {
        if (point === PEEK) return peek;
        const height = viewportHeight || (typeof window === 'undefined' ? 0 : window.innerHeight);
        if (index === 0 && fractionPeek) {
          return `${Math.max(peekPx, Math.round((point as number) * height))}px`;
        }
        if (!modal && keepAbove !== null && index > 0 && index < given.length - 1 && height > 0) {
          // The viewport's top is the window's (fixed, inset 0): its bottom is its height.
          const px = typeof point === 'number' ? (point <= 1 ? point * height : point) : Number.parseFloat(point);
          const most = Math.floor(height - keepAbove - FOCUS_AIR);
          if (Number.isFinite(px) && px > most) return `${Math.max(peekPx + 1, most)}px`;
        }
        return point;
      });
  const lastIndex = snapPoints ? snapPoints.length - 1 : 0;
  const peekIndex = snapPointsProp ? (fractionPeek ? 0 : snapPointsProp.indexOf(PEEK)) : modal ? -1 : 0;

  // The sheet rests at a snap point by index, so a peek that grows with the text stays the peek.
  const [snapIndex, setSnapIndex] = useState(0);
  // Every opening starts at the first snap point, however the sheet was closed before (Close,
  // Esc, Back) and whoever opens it (the trigger or a controlling parent).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSnapIndex(0);
  }
  const setOpen = (next: boolean, details?: DrawerChangeDetails) => {
    onOpenChange?.(next, details);
    // The caller kept the sheet as it is (details.cancel()): Base UI does not change it either.
    if (details?.isCanceled) return;
    if (openProp === undefined) setOpenState(next);
  };
  useBackToClose(open, () => setOpen(false));

  const expanded = snapIndex === lastIndex;
  const peeking = !side && snapIndex === peekIndex;
  useImperativeHandle(actions, () => ({
    collapse: () => {
      const first = Math.max(peekIndex, 0);
      if (!open || side || !snapPoints || snapIndex <= first) return false;
      setSnapIndex(first);
      return true;
    },
  }));

  // The snap point the sheet rests at, as given (a fraction stays a fraction), for the caller.
  const restsAt = useRef<number | null>(null);
  useEffect(() => {
    if (!open || side) {
      restsAt.current = null;
      return;
    }
    const index = Math.min(snapIndex, lastIndex);
    if (restsAt.current === index) return;
    restsAt.current = index;
    const point = given[index];
    if (point !== undefined) onSnapPointChange?.(point, index);
  });

  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  useSheetRoom(open, side, modal, viewport, popup, header, snapPoints ? (snapPoints[Math.min(snapIndex, lastIndex)] ?? null) : null, modal ? null : coverAbove);

  // Below full height the lower part of the sheet is off screen. A focus that lands there (Tab,
  // or a script restoring focus) expands the sheet first, so the focused control is never hidden
  // (WCAG 2.4.11). "There" means the control's first 48 px (or all of it, when shorter) do not
  // fit above the bottom edge, so a tall focusable region whose top shows does not expand it.
  // A focus that comes with a press of a finger or a mouse is left alone: moving the sheet in
  // the middle of a tap on a control that peeks over the edge would lose the tap.
  // Events from an overlay portalled out of this content (a nested sheet or menu) bubble here
  // through the React tree; they are not this sheet's, so they are ignored.
  const pressedAt = useRef(Number.NEGATIVE_INFINITY);
  const onContentFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
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
      <BaseDrawer.Portal keepMounted={keepMounted}>
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
            // From 768 px a bottom sheet is centred over the page, right of the rail.
            'fixed inset-0 z-50 flex items-end justify-center md:left-(--rail-w) lg:left-0 lg:items-stretch lg:justify-end',
            // A non-modal sheet lets taps through to the page around it. On phones it rests on the
            // tab bar (--tab-clear: the bar's real height and the bottom safe-area inset), and the
            // viewport clips the part of the popup that its snap point moves below that edge: the
            // tabs stay seen and tappable. Clip, not hidden: a hidden overflow is a scroll
            // container, which the browser scrolls to show a focused control instead of letting
            // onContentFocus expand the sheet.
            !modal && 'pointer-events-none bottom-(--tab-clear) max-lg:overflow-clip',
          )}
        >
          <BaseDrawer.Popup
            {...popupAttributes}
            ref={setPopup}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cn(
              'pointer-events-auto relative flex min-h-0 w-full flex-col border-border-subtle bg-surface-2 text-fg shadow-sheet outline-none',
              // Below 1024 px: a bottom sheet, never taller than its viewport (above the tab bar when non-modal).
              'max-h-[calc(100%-env(safe-area-inset-top,0px)-0.75rem)] max-w-[40rem] touch-none rounded-t-sheet border border-b-0',
              '[transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]',
              'data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]',
              // Outline seals inside fill with the sheet's ground (seal.tsx).
              '[--seal-ground:var(--surface-2)]',
              // From 1024 px: a side panel on the right, the full height of the window.
              'lg:h-full lg:max-h-none lg:w-sheet lg:max-w-[calc(100vw-4rem)] lg:rounded-none lg:border-0 lg:border-l',
              'lg:[transform:translateX(var(--drawer-swipe-movement-x,0px))]',
              'lg:data-starting-style:[transform:translateX(100%)] lg:data-ending-style:[transform:translateX(100%)]',
              'transition-transform duration-(--duration-slow) ease-out data-swiping:duration-0 data-swiping:select-none',
              className,
            )}
          >
            <div
              ref={setHeader}
              className="shrink-0 px-4 pt-2 pb-3 select-none sm:px-6 lg:pt-[max(1rem,env(safe-area-inset-top,0px))] lg:pr-[max(1rem,env(safe-area-inset-right,0px))]"
            >
              <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong lg:hidden" />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 pt-1">
                  {/* The title (usually a name) wraps as far as it needs and is never cut; the peek
                      grows with the header. Only the description is clamped, at two lines (its
                      full text stays the dialog's accessible description). leading-tight (1.25)
                      holds Gloock's 1.2 em ascent and descent. */}
                  <BaseDrawer.Title className="font-display text-xl leading-tight text-fg [overflow-wrap:anywhere]">
                    {title}
                  </BaseDrawer.Title>
                  {description ? (
                    <BaseDrawer.Description className="mt-0.5 line-clamp-2 text-sm text-fg-muted">{description}</BaseDrawer.Description>
                  ) : null}
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
              {headerActions ? <div className="mt-2 flex flex-wrap items-center gap-2">{headerActions}</div> : null}
            </div>
            <BaseDrawer.Content
              inert={peeking}
              onPointerDown={(event) => {
                if (event.currentTarget.contains(event.target as Node)) pressedAt.current = event.timeStamp;
              }}
              onFocus={onContentFocus}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:px-6 lg:pr-[max(1.5rem,env(safe-area-inset-right,0px))]"
            >
              {children}
            </BaseDrawer.Content>
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}

/** An element's height in px, kept as it changes (0 until there is one). */
function useHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver !== 'function') return;
    const update = () => setHeight(element.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

interface Room {
  /** When the sheet opened (rooms are published in this order, see the top of this file). */
  order: number;
  /** A non-modal sheet leaves the page live behind it, so the page keeps its room clear. */
  modal: boolean;
  /** Bottom sheet: px from the bottom of the window to its top edge. */
  clear: number | null;
  /** Side panel: its width. */
  inline: number | null;
  /** Bottom sheet: px from the top of the window to the bottom of its header. */
  head: number | null;
  /** A bottom sheet with less than 9rem of the window above it and more room under its header. */
  full: boolean;
  /** A bottom sheet with less than 9rem of the window above it, or less than its coverAbove: the page is behind it. */
  covers: boolean;
}

/** The room of every open sheet, by sheet. */
const rooms = new Map<symbol, Room>();
/** Counts openings, so a sheet keeps its place among the rooms when its effect runs again. */
let openings = 0;

/** Air between a focused page control and a non-modal sheet, for the 2 px focus ring and its offset. */
const FOCUS_AIR = 8;

/** Writes the newest open sheet's room on <html>, or removes it when no sheet is open. */
function publishRooms() {
  const root = document.documentElement;
  const all = [...rooms.values()].sort((a, b) => a.order - b.order);
  const newest = all.at(-1);
  const page = all.filter((room) => !room.modal).at(-1);
  const px = (value: number | null | undefined) => (value === null || value === undefined ? null : `${Math.round(value)}px`);
  for (const [name, value] of [
    ['--sheet-clear', px(newest?.clear)],
    ['--sheet-inline', px(newest?.inline)],
    ['--sheet-head', newest?.full ? px(newest.head) : null],
    ['--sheet-page-clear', page?.clear == null || page.covers ? null : px(page.clear + FOCUS_AIR)],
    ['--sheet-page-inline', px(page?.inline)],
  ] as const) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  root.toggleAttribute('data-sheet-full', !!newest?.full);
}

/** The top safe-area inset in px (env() is readable only through a box that uses it). */
function topInset(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;height:env(safe-area-inset-top,0px)';
  document.body.append(probe);
  const inset = probe.getBoundingClientRect().height;
  probe.remove();
  return inset;
}

/**
 * How tall a sheet resting at this snap point is, as Base UI resolves it (useDrawerSnapPoints): a
 * fraction of the viewport up to 1, px above it or as a px or rem string, never taller than the
 * popup or the viewport; null for a value Base UI does not resolve either.
 */
function restingHeight(point: SnapPoint, popup: number, viewport: number): number | null {
  let height: number | null = null;
  if (typeof point === 'number') height = point <= 1 ? Math.max(0, point) * viewport : point;
  else if (point.trim().endsWith('px')) height = Number.parseFloat(point);
  else if (point.trim().endsWith('rem')) height = Number.parseFloat(point) * (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  return height === null || !Number.isFinite(height) ? null : Math.min(Math.max(0, height), popup, viewport);
}

/**
 * Publishes the room an open sheet takes. The snap offset comes from the popup's inline style
 * (Base UI), so the page is restyled only when the snap point or a size changes. With snap points
 * the room is the height of the one the sheet rests at (`rest`), resolved as Base UI resolves it:
 * Base UI sets the offset a render after it measures a new popup height, so a new height read
 * with the old offset (the sheet's content changes: another person selected in the explorer)
 * would publish, for a frame, a room the sheet never takes. `coverAbove`: see DrawerProps.
 */
function useSheetRoom(
  open: boolean,
  side: boolean,
  modal: boolean,
  viewport: HTMLElement | null,
  popup: HTMLElement | null,
  header: HTMLElement | null,
  rest: SnapPoint | null,
  coverAbove: number | null,
) {
  // One key per sheet, and one place in the opening order per opening: the effect below runs
  // again when the sheet turns into a side panel or its elements change, and must not move the
  // sheet ahead of one opened after it.
  const [key] = useState(() => Symbol('sheet'));
  const order = useRef(0);
  useEffect(() => {
    if (open) order.current = ++openings;
  }, [open]);

  useEffect(() => {
    if (!open || !viewport || !popup) return;
    let offset: string | null = null;
    let inset = 0;
    const measure = (force: boolean) => {
      if (side) {
        rooms.set(key, { order: order.current, modal, clear: null, inline: popup.offsetWidth, head: null, full: false, covers: false });
        publishRooms();
        return;
      }
      const next = popup.style.getPropertyValue('--drawer-snap-point-offset');
      if (!force && next === offset) return;
      offset = next;
      // The insets change only with the window (rotation), which resizes the viewport.
      if (force) inset = topInset();
      const resting = rest === null ? null : restingHeight(rest, popup.offsetHeight, viewport.offsetHeight);
      const visible = resting ?? Math.max(0, popup.offsetHeight - (Number.parseFloat(next) || 0));
      const bottom = viewport.getBoundingClientRect().bottom;
      const top = bottom - visible;
      // The popup's 1 px top border, then the header.
      const head = top + 1 + (header?.offsetHeight ?? 0);
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const short = top < inset + 9 * rem;
      rooms.set(key, {
        order: order.current,
        modal,
        clear: window.innerHeight - top,
        inline: null,
        head,
        // Under the header only where that leaves more room than above the sheet (not over a
        // peek in a short landscape window, where the header itself is low on the screen).
        full: short && window.innerHeight - head > top - inset,
        // The page's room ends FOCUS_AIR above the sheet (publishRooms).
        covers: short || (coverAbove !== null && top - FOCUS_AIR < coverAbove),
      });
      publishRooms();
    };
    measure(true);
    const styles = new MutationObserver(() => measure(false));
    styles.observe(popup, { attributes: true, attributeFilter: ['style'] });
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure(true)) : null;
    sizes?.observe(popup);
    sizes?.observe(viewport);
    // At full height the popup is capped, so a header that grows (a longer title, larger text)
    // does not resize it; the header is watched on its own for --sheet-head.
    if (header) sizes?.observe(header);
    return () => {
      styles.disconnect();
      sizes?.disconnect();
      rooms.delete(key);
      publishRooms();
    };
  }, [key, open, side, modal, viewport, popup, header, rest, coverAbove]);
}
