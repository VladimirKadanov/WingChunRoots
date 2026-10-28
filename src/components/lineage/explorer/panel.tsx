'use client';

// The selection's panel (plan §4.7, §5.6; milestone M06, package B): from 768 px an overlay over
// the canvas, top right; below it a non-modal bottom sheet (the Drawer, snap points 0.15, 0.5 and
// 0.92). It holds the routes of descent of the selected person in the view, their teachers, "Focus
// this lineage", "Show ended training", the expand actions and the M05 links; for a summary node,
// the teacher's students. It loads in a chunk of its own, asked for with the canvas's
// (explorer.tsx), and works the URL itself (the explorer's state): what it links to and what its
// buttons change stay out of the explorer's first JavaScript. The "Open profile" link comes from
// the explorer.
//
// The body renders a step behind the header (useDeferredValue): a selection draws the ring, the lit
// routes and the sheet's header at once, the rest of the panel in the next, interruptible render.
//
// The sheet (DEFAULT, no D number unless named):
// - Its peek (0.15, floored at the measured header) holds the name, Expand, Close and one row of
//   actions: "Open profile" and "Center on this person". Focus stays on the node when it opens.
// - At 0.5 the frame above it is shorter: the active node is moved into view once the frame has
//   settled. At 0.92 it covers the graph (no page room is kept), so a focus in the graph moves into
//   the sheet; when it comes down again, the active node is moved into view, and the focus goes
//   back to it when it is still on the sheet itself.
// - Closed from inside (Close, Esc, a swipe), focus returns to the active node, at once (the body
//   turns inert as the sheet closes); closed from the graph (Esc there), focus stays where it is.
//   Esc in the graph is the graph's (keys.tsx: a raised sheet comes down to its peek first, then
//   the selection is cleared): the Drawer's own Esc, which listens on the document, is cancelled
//   there and in other layers (a menu, a dialog).
// - It is closed while the List view is shown (explorer.tsx), and its history entry (Back closes
//   it) is handed back to the page first, so closing it does not step back over the URL change.
//   A link in it takes that entry (router.replace), so Back from where it leads returns to the
//   explorer in one step; leaving the List view aside, the sheet closes with it.
//
// A panel control that has the focus and goes with its own action ("Show N more students" once
// everyone is drawn, "Focus this lineage", "List all students", the list's Close) leaves the focus
// to the panel, or with the panel gone to the active node: never to <body> (useFocusKept).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { CheckIcon, CloseIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { Drawer, type DrawerActions, type DrawerChangeDetails, type SnapPoint } from '@/components/ui/drawer';
import { releaseLayerEntry } from '@/components/ui/use-back-to-close';
import { useMediaQuery } from '@/components/ui/use-media-query';
import type { LineageEdgeDto, LineageGraphDto, LineageNodeDto } from '@/server/dto/public';

import type { GenerationLabel } from '../generation';
import { GenerationText } from '../generation-text';
import { LatinName, PersonLink } from '../person-name';
import { RelationBadges } from '../relation-list';
import { periodText } from '../status';
import type { CanvasHandle, NodeActions, PanelHandle } from './graph-api';
import { countsInView, ExpandActions } from './node-controls';
import { routeList } from './route-list';
import type { RouteSource } from './routes';
import { explorerHref, type ExplorerParams, viewKind } from './state';
import { StudentsList } from './students-list';

/** What the panel shows: the selected person, or the students of a teacher (the summary node "and N more"). */
export type PanelMode = { kind: 'person'; id: string } | { kind: 'students'; teacherId: string };

/** The explorer's URL state (nuqs): the view, and the list view's own keys. */
export interface PanelUrl extends ExplorerParams {
  page: string | null;
  routes: string | null;
}

export interface PanelProps {
  /** Shown: a selection or a students list, while the graph is shown (explorer.tsx). */
  open: boolean;
  mode: PanelMode | null;
  /** The view as drawn (the answer and its expansions, the fan-outs capped). */
  graph: LineageGraphDto;
  /** The selected person (mode person). */
  person: LineageNodeDto | null;
  /** The selected person's generation label in the view. */
  generation: GenerationLabel | null;
  /** The selected person's students not drawn. */
  more: number;
  /** "Open profile", the selected person's profile link (built by the explorer). */
  openProfile: ReactNode;
  /** Where the routes of descent of the selection in the view are read from (routes.ts litOf). */
  routes: RouteSource | null;
  /** The explorer's URL state, and its setter: centring, "Focus this lineage", "Show ended training", the list view's links. */
  url: PanelUrl;
  setUrl: (patch: Partial<PanelUrl>) => unknown;
  /** Close: clears the selection (and the students list). */
  onClose: () => void;
  /** The expand actions and the students list (package C). */
  actions: NodeActions;
  /** For Esc on a raised sheet (canvas.tsx collapseSheet). */
  handle: Ref<PanelHandle>;
  /** The canvas: focus back to the graph, the active node kept in view by a sheet's snap. */
  canvas: RefObject<CanvasHandle | null>;
}

/** From this width the panel is an overlay over the canvas; below it a bottom sheet (DEFAULT, plan §10.1 e3). */
const OVERLAY_QUERY = '(min-width: 48rem)';
/** The sheet's snap points (milestone M06): the peek, half and nearly full height. */
const SNAP_POINTS: SnapPoint[] = [0.15, 0.5, 0.92];
const TOP = SNAP_POINTS.length - 1;

// M06 seam: students (C). The panel's place and frame for a teacher's students, as the person's below.
const STUDENTS_PANEL =
  'grid max-h-[50%] shrink-0 content-start gap-3 overflow-y-auto overscroll-contain border-t border-border-strong bg-surface-1 py-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] md:absolute md:top-3 md:right-[calc(max(0.75rem,env(safe-area-inset-right,0px))+3.5rem)] md:z-20 md:max-h-[calc(100%-1.5rem)] md:w-[min(22rem,calc(100%-5rem))] md:rounded-sm md:border md:p-4 md:shadow-pop';

// Over the graph on the right (plan §4.7), left of the zoom buttons' column (44 px and its border),
// so a short pane (a phone turned to landscape) does not cover them either; above the home
// indicator, and above the legend where the two meet (useClearHeight).
const PERSON_PANEL =
  'absolute top-3 right-[calc(max(0.75rem,env(safe-area-inset-right,0px))+3.5rem)] z-20 grid max-h-[calc(100%-1.5rem-env(safe-area-inset-bottom,0px))] w-[min(22rem,calc(100%-5rem))] content-start gap-3 overflow-y-auto overscroll-contain rounded-sm border border-border-strong bg-surface-1 p-4 shadow-pop outline-none [--seal-ground:var(--surface-1)]';

/** The panel's element that takes the focus when a control in it goes (useFocusKept): the overlay's section, or the sheet. */
const PANEL_HOME = '[data-panel-home]';

const closeButton =
  '-mt-2 -mr-2 inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg';

/** What the panel shows, kept while a closing sheet slides away. */
interface Subject {
  mode: PanelMode | null;
  person: LineageNodeDto | null;
  teacher: LineageNodeDto | null;
  generation: GenerationLabel | null;
  more: number;
  routes: RouteSource | null;
  openProfile: ReactNode;
  graph: LineageGraphDto;
}

/** The same subject, shown the same way (the explorer builds `mode` anew on every render). */
const sameSubject = (a: Subject, b: Subject) =>
  a.mode?.kind === b.mode?.kind &&
  a.person === b.person &&
  a.teacher === b.teacher &&
  a.generation === b.generation &&
  a.more === b.more &&
  a.routes === b.routes &&
  a.openProfile === b.openProfile &&
  a.graph === b.graph;

export default function ExplorerPanel(props: PanelProps) {
  const { open, mode, graph, person, url, setUrl, onClose, canvas } = props;
  const overlay = useMediaQuery(OVERLAY_QUERY);
  const sheet = useRef<DrawerActions>(null);
  /** The snap point the sheet last rested at. */
  const restedAt = useRef(0);
  useImperativeHandle(props.handle, () => ({ collapse: () => sheet.current?.collapse() ?? false }), []);
  // The panel leaves with the graph (List, or no canvas): its sheet's history entry goes back to
  // the page before the Drawer's cleanup (a passive effect) would step back over the URL change.
  useLayoutEffect(() => releaseLayerEntry, []);

  const teacher = mode?.kind === 'students' ? (graph.nodes.find((n) => n.id === mode.teacherId) ?? null) : null;
  const live = open && (mode?.kind === 'person' ? person !== null : teacher !== null);
  const current: Subject = { mode, person, teacher, generation: props.generation, more: props.more, routes: props.routes, openProfile: props.openProfile, graph };
  // Kept as state: one object while it stays the same, so the deferred body renders once per change.
  const [subject, setSubject] = useState(current);
  if (live && !sameSubject(subject, current)) setSubject(current);
  // The body a step behind the header: rendered when it is the same subject's, else nothing yet.
  const deferred = useDeferredValue(subject);
  // By id: an expansion gives the same person a new object (mergeExpansion), and the body, with the
  // focus in it, must not go for a render.
  const body =
    deferred.mode?.kind === subject.mode?.kind && deferred.person?.id === subject.person?.id && deferred.teacher?.id === subject.teacher?.id ? deferred : null;
  // The sheet opens a step behind the selection (plan §5.8 (c), INP): the tap paints the selected
  // node and its lit routes first, and the Drawer's opening (its measures, the page room it takes,
  // its history entry) follows in a deferred render. It closes at once.
  const opening = useDeferredValue(live);
  const sheetOpen = live && opening;
  /** The sheet took the focus from the graph at its top snap point (onSheetSnap). */
  const tookFocus = useRef(false);
  // Every opening starts at the peek (the Drawer's first snap point), not where the last one rested.
  useEffect(() => {
    if (sheetOpen) return;
    restedAt.current = 0;
    tookFocus.current = false;
  }, [sheetOpen]);
  useFocusKept(canvas);
  const router = useRouter();
  const keepAbove = useKeepAbove(sheetOpen && !overlay, canvas, subject.person?.id ?? null);
  useRevealFocused(live && overlay, canvas, live ? `${mode?.kind}:${(person ?? teacher)?.id}` : null);

  const kind = viewKind(url);
  // The lineage view reads the lineage from its root, whoever is in focus: centring there opens the person view.
  const centerOn = (id: string) => setUrl(kind === 'lineage' ? { focus: id, lineage: null, page: null, routes: null } : { focus: id, page: null, routes: null });

  if (overlay) {
    if (!live) return null;
    if (teacher) {
      return (
        <section
          aria-labelledby="explorer-students-heading"
          tabIndex={-1}
          data-testid="explorer-panel"
          data-canvas-cover=""
          data-panel-home=""
          className={`${STUDENTS_PANEL} outline-none`}
          onKeyDown={(event) => {
            // Esc in the list closes it, as in the graph (keys.tsx), and the focus goes back to the graph.
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            props.actions.closeStudents();
            canvas.current?.focusActive();
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <h2 id="explorer-students-heading" className="font-display text-xl leading-tight [overflow-wrap:anywhere]">
              Students of <LatinName name={teacher.displayName} />
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                // The focus goes back to the graph, as with Esc: the button goes with the list.
                onClose();
                canvas.current?.focusActive();
              }}
              className={closeButton}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <StudentsList key={teacher.id} teacherId={teacher.id} slug={teacher.slug} name={teacher.displayName} />
        </section>
      );
    }
    return <PersonOverlay {...props} person={person!} body={body} centerOn={centerOn} />;
  }

  const shown = subject.person;
  const students = subject.mode?.kind === 'students' ? subject.teacher : null;
  // The body shown: this subject's, or while it is a step behind, the last person's (kept unseen below).
  const kept = body ?? (deferred.mode?.kind === 'person' ? deferred : null);
  const title = students ? (
    <>
      Students of <LatinName name={students.displayName} />
    </>
  ) : shown ? (
    <LatinName name={shown.displayName} />
  ) : (
    ''
  );
  return (
    <Drawer
      open={sheetOpen}
      onOpenChange={(next: boolean, details?: DrawerChangeDetails) => {
        if (next) return;
        // Esc in the graph is the graph's (keys.tsx), and Esc in another layer is that layer's.
        if (details && (details.reason === 'escape-key' || details.reason === 'close-watcher') && !escapeIsTheSheets()) {
          details.cancel();
          return;
        }
        // Decided now, not in finalFocus: the body turns inert as the sheet closes, and a control
        // focused there has dropped the focus to <body> by the time finalFocus runs.
        const fromInside = !!document.activeElement?.closest('[data-explorer-sheet]');
        onClose();
        if (fromInside) focusActiveNode(canvas);
      }}
      title={title}
      snapPoints={SNAP_POINTS}
      modal={false}
      keepMounted
      initialFocus={false}
      finalFocus={() => focusBack(canvas)}
      onSnapPointChange={(_point, index) => {
        const was = restedAt.current;
        restedAt.current = index;
        onSheetSnap(index, was, canvas, tookFocus);
      }}
      actions={sheet}
      keepAbove={keepAbove}
      popupAttributes={{ 'data-testid': 'explorer-panel', 'data-explorer-sheet': '', 'data-panel-home': '', 'data-canvas-cover': sheetOpen ? '' : undefined }}
      headerActions={
        shown && !students ? (
          <div className="contents" onClickCapture={(event) => followInSheet(event, router, onClose)}>
            {subject.openProfile}
            {shown.id !== url.focus ? (
              <button
                type="button"
                className={buttonVariants({ variant: 'secondary' })}
                onClick={() => {
                  centerOn(shown.id);
                  // The button goes with the change (the person is in focus now): the focus stays in the sheet.
                  sheetElement()?.focus({ preventScroll: true });
                }}
              >
                Center on this person
              </button>
            ) : null}
          </div>
        ) : null
      }
    >
      <div className="contents" onClickCapture={(event) => followInSheet(event, router, onClose)}>
        {students ? (
          <StudentsList key={students.id} teacherId={students.id} slug={students.slug} name={students.displayName} />
        ) : kept?.person ? (
          // While the next person's body is a step behind, the last one keeps its place, unseen and
          // inert: the sheet keeps its height, so the room it takes from the page (and the canvas
          // frame above it) does not jump to the header and back on every selection.
          <div inert={kept !== body || undefined} className={kept !== body ? 'invisible' : undefined}>
            <PersonBody subject={kept} person={kept.person} url={url} setUrl={setUrl} actions={props.actions} kind={kind} />
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

/** The overlay of a selected person, from 768 px. */
function PersonOverlay({
  person,
  body,
  centerOn,
  openProfile,
  url,
  setUrl,
  onClose,
  actions,
  canvas,
}: PanelProps & { person: LineageNodeDto; body: Subject | null; centerOn: (id: string) => void }) {
  const section = useRef<HTMLElement>(null);
  const height = useClearHeight(section);
  const close = () => {
    onClose();
    canvas.current?.focusActive();
  };
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label={`Selected: ${person.displayName}`}
      data-testid="explorer-panel"
      data-canvas-cover=""
      data-panel-home=""
      className={PERSON_PANEL}
      style={height === null ? undefined : { maxHeight: height }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        close();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-xl leading-tight [overflow-wrap:anywhere]">
          <LatinName name={person.displayName} />
        </h2>
        <button type="button" aria-label="Close" onClick={close} className={closeButton}>
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {openProfile}
        {person.id !== url.focus ? (
          <button
            type="button"
            className={buttonVariants({ variant: 'secondary' })}
            onClick={() => {
              centerOn(person.id);
              section.current?.focus({ preventScroll: true });
            }}
          >
            Center on this person
          </button>
        ) : null}
      </div>
      {body?.person ? <PersonBody subject={body} person={body.person} url={url} setUrl={setUrl} actions={actions} kind={viewKind(url)} /> : null}
    </section>
  );
}

/** The selected person's details: generation, routes of descent, teachers and the actions on the view. */
function PersonBody({
  subject,
  person,
  url,
  setUrl,
  actions,
  kind,
}: {
  subject: Subject;
  person: LineageNodeDto;
  url: PanelUrl;
  setUrl: PanelProps['setUrl'];
  actions: NodeActions;
  kind: ReturnType<typeof viewKind>;
}) {
  const { graph, generation, more } = subject;
  const routes = routeList(subject.routes, graph);
  const id = useId();
  const people = new Map(graph.nodes.map((n) => [n.id, n]));
  const nameOf = (personId: string) => people.get(personId)?.displayName ?? '';
  // DEFAULT D05: the display-primary teacher first, then the primary lines, then the answer's order.
  const rank = (e: LineageEdgeDto) => (e.isDisplayPrimary ? 0 : e.kind === 'primary' ? 1 : 2);
  const lines = graph.edges.filter((e) => e.studentId === person.id && people.has(e.teacherId)).sort((a, b) => rank(a) - rank(b));
  // DEFAULT D05: "Focus this lineage" opens the lineage of the display-primary teacher's line, else the person's first.
  const lineage = lines[0]?.lineageId ?? person.lineageIds[0] ?? null;
  const lineageName = graph.lineages.find((l) => l.id === lineage)?.name ?? null;
  const showHistorical = url.show === 'historical';
  // The list view inside the explorer, with this person in focus (the lineage view centres on a
  // person as the person view, as "Center on this person" does).
  const listHref = (extra: Record<string, string>, hash: string) =>
    `${explorerHref({ ...url, focus: person.id, view: 'list', ...(kind === 'lineage' ? { lineage: null } : {}) }, extra)}#${hash}`;
  const rest = routes.total - routes.shown.length;
  return (
    <div className="grid gap-5 pb-2">
      {generation ? (
        <p className="text-sm text-fg-muted">
          <GenerationText label={generation} />
        </p>
      ) : null}

      <section aria-labelledby={`${id}-routes`} className="grid gap-3">
        <h3 id={`${id}-routes`} className="text-ui font-semibold">
          Routes of descent in this view
        </h3>
        {routes.shown.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No teacher of <LatinName name={person.displayName} /> is drawn in this view.
          </p>
        ) : (
          routes.shown.map((route, k) => {
            const head = `${id}-route-${k}`;
            const root = route.people[0]!;
            return (
              <div key={route.edges.join(' ')} className="grid gap-1.5">
                <h4 id={head} className="text-sm font-semibold [overflow-wrap:anywhere]">
                  Route {k + 1} of {routes.total.toLocaleString('en')}: <LatinName name={nameOf(root)} /> {route.people.length > 2 ? '→ … →' : '→'}{' '}
                  <LatinName name={person.displayName} />
                </h4>
                <ol aria-labelledby={head} className="grid gap-0.5 border-l-2 border-fg pl-3 text-sm">
                  {route.people.map((step) => (
                    <li key={step} className="[overflow-wrap:anywhere]">
                      <LatinName name={nameOf(step)} />
                    </li>
                  ))}
                </ol>
              </div>
            );
          })
        )}
        {rest > 0 ? (
          <Link href={listHref({ routes: 'all' }, 'routes-heading')} className="link inline-flex min-h-11 items-center text-sm">
            {rest.toLocaleString('en')} more {rest === 1 ? 'route' : 'routes'} in the list view
          </Link>
        ) : null}
      </section>

      {lines.length > 0 ? (
        <section aria-labelledby={`${id}-teachers`} className="grid gap-1">
          <h3 id={`${id}-teachers`} className="text-ui font-semibold">
            {lines.length === 1 ? 'Teacher' : 'Teachers'}
          </h3>
          <ul className="grid">
            {lines.map((e) => {
              const teacher = people.get(e.teacherId)!;
              return (
                <li key={e.id} className="grid gap-0.5 border-b border-border-subtle pb-2 last:border-b-0">
                  <PersonLink person={teacher} className="text-ui" />
                  <span className="text-sm text-fg-muted">{periodText(e.periods)}</span>
                  <RelationBadges edge={e} role="teacher" />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {lineage && !(kind === 'lineage' && url.lineage === lineage && url.focus === person.id) ? (
          <button
            type="button"
            className={buttonVariants({ variant: 'secondary' })}
            aria-label={lineageName ? `Focus this lineage: ${lineageName}` : undefined}
            onClick={() => setUrl({ focus: person.id, lineage, up: null, down: null, page: null, routes: null })}
          >
            Focus this lineage
          </button>
        ) : null}
        {/* A toggle: pressed, it is drawn in ink with a check mark (its state not by colour alone). */}
        <button
          type="button"
          aria-pressed={showHistorical}
          className={buttonVariants({ variant: showHistorical ? 'ink' : 'secondary' })}
          onClick={() => setUrl({ show: showHistorical ? null : 'historical' })}
        >
          {showHistorical ? <CheckIcon size={18} /> : null}
          Show ended training
        </button>
      </div>

      <ExpandActions id={person.id} name={person.displayName} counts={countsInView(graph, person.id, more, showHistorical)} actions={actions} />

      {more > 0 ? (
        // Plan §4.8: the students a large fan-out does not draw are a paginated list away.
        <Link href={listHref({}, 'students-heading')} className="link inline-flex min-h-11 items-center text-sm">
          All students in the list view (+{more} not drawn)
        </Link>
      ) : null}
    </div>
  );
}

/** The gap the overlay keeps from the canvas's own overlays below it (0.75rem). */
const OVERLAY_GAP = 12;
/** The overlay is never made shorter than this (a pane too short for both shows the panel over the legend). */
const OVERLAY_MIN_HEIGHT = 128;

/**
 * The overlay's height that ends above the canvas's own overlays it would reach (the legend, the
 * zoom buttons: data-canvas-overlay), or null where none lies below it. In a short pane, a phone
 * turned to landscape, the panel then ends above the legend instead of covering it; its body
 * scrolls (M05: the legend and the zoom buttons stay in view and uncovered).
 */
function useClearHeight(panel: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const area = element?.parentElement;
    if (!element || !area || typeof ResizeObserver !== 'function') return;
    const overlays = () => [...area.querySelectorAll<HTMLElement>('[data-canvas-overlay]')];
    const measure = () => {
      const box = element.getBoundingClientRect();
      let room = Number.POSITIVE_INFINITY;
      for (const overlay of overlays()) {
        const r = overlay.getBoundingClientRect();
        if (r.right > box.left && r.left < box.right && r.top > box.top) room = Math.min(room, r.top - box.top - OVERLAY_GAP);
      }
      setHeight(Number.isFinite(room) ? Math.max(Math.floor(room), OVERLAY_MIN_HEIGHT) : null);
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(area);
    for (const overlay of overlays()) sizes.observe(overlay);
    return () => sizes.disconnect();
  }, [panel]);
  return height;
}

/**
 * How far down the window the canvas must still reach above the sheet at its middle snap point
 * (the Drawer's keepAbove): the legend and the selected person's card fit whole in it (plan §4.6:
 * the legend is always in view; canvas.tsx keepInView), measured on the page, not a phone's size
 * (DEFAULT, no D number). On a tall phone that is above half height and the point stays 0.5; on a
 * short one (393x659) the point is lowered. Measured when the sheet opens or shows another person,
 * and when the window changes; not on every zoom.
 */
function useKeepAbove(open: boolean, canvas: RefObject<CanvasHandle | null>, person: string | null): number | null {
  const [keepAbove, setKeepAbove] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const next = canvas.current?.keepInView() ?? null;
      setKeepAbove((now) => (now === next ? now : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, canvas, person]);
  return open ? keepAbove : null;
}

/**
 * From md the panel lies over the canvas (data-canvas-cover). When it opens, shows another person
 * or teacher, or changes its size (a list of students arrives and the panel grows over the node it
 * came from), while the keyboard focus is on a node, the view moves that node out from under it
 * (WCAG 2.4.11, focus not obscured; canvas.tsx ensureVisible counts the panel as a cover). After
 * the paint, so the key's response (INP) does not grow; a click (no visible focus) leaves the view
 * where it is.
 */
function useRevealFocused(open: boolean, canvas: RefObject<CanvasHandle | null>, subject: string | null) {
  useEffect(() => {
    if (!open || typeof ResizeObserver !== 'function') return;
    let timer: number | undefined;
    // A task queued from a ResizeObserver callback runs after that frame is painted; one per frame.
    const sizes = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const at = document.activeElement;
        if (at instanceof HTMLElement && at.matches('.react-flow__node:focus-visible')) canvas.current?.ensureVisible();
      });
    });
    // Observing calls back once at the start: the panel as it opens.
    for (const cover of document.querySelectorAll('[data-canvas-cover]')) sizes.observe(cover);
    return () => {
      sizes.disconnect();
      window.clearTimeout(timer);
    };
  }, [open, canvas, subject]);
}

/** The sheet's element (its popup), when there is one. */
function sheetElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-explorer-sheet]');
}

/**
 * Whether an Esc is the sheet's own: pressed in the sheet, or with the focus nowhere in particular
 * (the page's body, or a control of the page). Not in the graph (keys.tsx has its own Esc order)
 * nor in another layer (the teacher chooser, the shortcut help, the search palette).
 */
function escapeIsTheSheets(): boolean {
  const at = document.activeElement;
  if (!at || at === document.body || at === document.documentElement) return true;
  if (at.closest('[data-explorer-sheet]')) return true;
  return !at.closest('.react-flow, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
}

/** Where focus goes when the sheet closes: back to the active node when it was in the sheet, else nowhere new. */
function focusBack(canvas: RefObject<CanvasHandle | null>): HTMLElement | false {
  const at = document.activeElement;
  if (!at || !at.closest('[data-explorer-sheet]')) return false;
  const node = canvas.current?.activeElement() ?? null;
  if (node) return node;
  // The active node is not drawn (off screen): the canvas moves it into view and focuses it.
  canvas.current?.focusActive();
  return false;
}

/** Focuses the active node: where it is drawn, else the canvas moves it into view first. */
function focusActiveNode(canvas: RefObject<CanvasHandle | null>) {
  const node = canvas.current?.activeElement() ?? null;
  if (node) node.focus({ preventScroll: true });
  else canvas.current?.focusActive();
}

/**
 * The sheet came to rest at a snap point (from `was`): keep the active node in view, or move the
 * focus into a sheet that covers the graph (`tookFocus`), and back to the active node when the sheet
 * comes down again with the focus still on the sheet itself.
 */
function onSheetSnap(index: number, was: number, canvas: RefObject<CanvasHandle | null>, tookFocus: { current: boolean }) {
  if (index === TOP) {
    tookFocus.current = !!document.activeElement?.closest('.react-flow');
    if (tookFocus.current) sheetElement()?.focus({ preventScroll: true });
    return;
  }
  const giveBack = was === TOP && tookFocus.current;
  tookFocus.current = false;
  if (index === 1 || was === TOP) {
    afterFrameSettles(() => {
      if (giveBack && document.activeElement === sheetElement()) canvas.current?.focusActive();
      else canvas.current?.ensureVisible();
    });
  }
}

/**
 * A click on a link in the sheet (code-2): the destination takes the sheet's history entry
 * (releaseLayerEntry, then router.replace, as the search palette does), so one Back returns to the
 * explorer. The sheet closes with it (its selection cleared), except for the List view, whose
 * selection opens the sheet again back in Graph. A new tab or window is the browser's.
 */
function followInSheet(event: MouseEvent<HTMLElement>, router: ReturnType<typeof useRouter>, close: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement) || (link.target !== '' && link.target !== '_self') || link.hasAttribute('download') || link.origin !== window.location.origin) return;
  event.preventDefault();
  releaseLayerEntry();
  const list = link.pathname === window.location.pathname && new URLSearchParams(link.search).get('view') === 'list';
  if (!list) close();
  router.replace(`${link.pathname}${link.search}${link.hash}`);
}

/**
 * Keeps the keyboard focus off <body> when the panel control that has it leaves the DOM with its
 * own action (code-1, a11y-4). After the commit that removed it, the panel as it is now takes the
 * focus (PANEL_HOME: the overlay's section, the list's, or the sheet), else, with the panel gone,
 * the active node. Only a control that went while the focus is on <body> is followed (no blur is
 * relied on: browsers differ on firing one for a removed element).
 */
function useFocusKept(canvas: RefObject<CanvasHandle | null>) {
  const holder = useRef<Element | null>(null);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      holder.current = target?.closest(PANEL_HOME) ? target : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  // After every commit of the panel: cheap, and only a control gone with the focus acts.
  useLayoutEffect(() => {
    const was = holder.current;
    if (!was || was.isConnected) return;
    holder.current = null;
    const at = document.activeElement;
    if (at && at !== document.body) return;
    const home = document.querySelector<HTMLElement>(PANEL_HOME);
    if (home && home.getClientRects().length > 0) home.focus({ preventScroll: true });
    else canvas.current?.focusActive();
  });
}

/**
 * Runs `then` once the canvas frame keeps its height (the sheet's room is published as it comes
 * to rest): by time, at most about a second, not by a count of frames (WebKit can paint none for a while).
 */
function afterFrameSettles(then: () => void) {
  const frame = document.querySelector('[data-canvas-frame]');
  const start = performance.now();
  let last = -1;
  let still = 0;
  const step = () => {
    const height = frame?.getBoundingClientRect().height ?? 0;
    still = height === last ? still + 1 : 0;
    last = height;
    if (still >= 3 || performance.now() - start > 1000) then();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
