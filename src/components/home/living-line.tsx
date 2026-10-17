'use client';

// The living lineage of the home page: an ink spine of one fictional line, eight generations
// from Foshan to Sofia, and a demo search. Untraced, the line is a pencil draft: thin strokes in
// the solid dimmed tone that keep each link's pattern, with ghost seals (plan §4.7). Tapping a
// row (or a search result, or "Trace this hall's line" further down) traces the line from the
// founder to that person: the strokes ink in at full weight one generation at a time and each
// seal is pressed in its state's colour after its stroke, within one second and only after a
// tap (plan §5.8 (e)). The rows beyond the traced person stay in the draft and take the dimmed
// text tones. "Back to <name>" returns to the previous person (Constellation's trail chip).
//
// On phones and tablets the line comes straight after the headline, so the first screen shows
// the subject itself; the introduction and the search follow it. From 1280 px the line has a
// column of its own, wide enough that each name and its original stay on one line (so the rows
// keep the even height the server draws the spine for), beside the headline and the search.

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CloseIcon, SearchIcon } from '@/components/icons';
import { InkShapeSvg } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { SEAL_DELAY, evenRows, inkStep, spineGeometry } from '@/components/ink/spine';
import { TrailChip } from '@/components/ui/trail-chip';
import { linkStyles } from '@/design/tokens';
import { cx } from '@/lib/cx';
import { DEMO_LINE, DEMO_LINE_LINKS, searchDemoLine } from './demo-lineage';
import { Name, PersonName } from './names';
import { ROW_TONES, TRACE_LINE_EVENT, type TraceLineDetail } from './trace-line';

/** Row height at every width (min-h-16), so the spine drawn on the server matches the rows. */
const ROW = 64;
const NODE_OFFSET = 12;
const STATES = DEMO_LINE_LINKS.map((link) => link.state);
const EVEN = evenRows(DEMO_LINE.length, ROW, NODE_OFFSET);
const TRY = ['盧嵐峰', 'Probnova', 'Примеров', 'Vienna'];
const verifiedCount = DEMO_LINE_LINKS.filter((link) => link.state === 'verified').length;
const reviewCount = DEMO_LINE_LINKS.length - verifiedCount;

function traceSummary(focus: number): ReactNode {
  const person = DEMO_LINE[focus]!;
  if (focus === 0)
    return (
      <>
        <Name>{person.name}</Name> founded the line in {person.startYear}.
      </>
    );
  const links = DEMO_LINE_LINKS.slice(0, focus);
  const verified = links.filter((l) => l.state === 'verified').length;
  const review = links.length - verified;
  const parts = [`${verified} verified`];
  if (review) parts.push(`${review} under review`);
  return (
    <>
      Traced from <Name>{DEMO_LINE[0]!.name}</Name> to <Name>{person.name}</Name>: {links.length}{' '}
      {links.length === 1 ? 'link' : 'links'}, {parts.join(', ')}.
    </>
  );
}

/** Where each person's node sits: level with the first line of the name, measured per row. */
function measureRows(list: HTMLOListElement): { ys: number[]; height: number } {
  const ys = [...list.querySelectorAll<HTMLElement>('[data-row]')].map((row) => {
    const name = row.querySelector<HTMLElement>('[data-name]');
    const lineHeight = name ? Number.parseFloat(getComputedStyle(name).lineHeight) || 0 : 0;
    return Math.round(row.offsetTop + Math.max(NODE_OFFSET, lineHeight / 2 + 1));
  });
  return { ys, height: list.offsetHeight };
}

export function LivingLine({ heading, lede }: { heading: ReactNode; lede: ReactNode }) {
  const [trail, setTrail] = useState<number[]>([]);
  const [run, setRun] = useState(0);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [rowsAt, setRowsAt] = useState(EVEN);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const list = useRef<HTMLOListElement>(null);
  const figure = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const searchId = useId();

  const focus = trail.length ? trail[trail.length - 1]! : null;
  const previous = trail.length > 1 ? trail[trail.length - 2]! : null;
  const results = composing ? [] : searchDemoLine(query);
  const step = inkStep(focus ?? 0);
  const geometry = spineGeometry(STATES, rowsAt.ys, rowsAt.height);

  const trace = (index: number, moveFocus = false) => {
    setTrail((t) => (t[t.length - 1] === index ? t : [...t, index].slice(-12)));
    setRun((r) => r + 1);
    if (moveFocus) {
      const row = rows.current[index];
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    }
  };

  // Rows grow with the reader's text size and wrap on narrow phones: the spine follows them.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const update = () => {
      const next = measureRows(el);
      setRowsAt((current) =>
        current.height === next.height && current.ys.every((y, i) => y === next.ys[i]) ? current : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // "Trace this hall's line" elsewhere on the page.
  const onTraceRequest = useEffectEvent((event: Event) => {
    const index = (event as CustomEvent<TraceLineDetail>).detail?.index ?? DEMO_LINE.length - 1;
    figure.current?.scrollIntoView({ block: 'start' });
    trace(index, true);
  });
  useEffect(() => {
    window.addEventListener(TRACE_LINE_EVENT, onTraceRequest);
    return () => window.removeEventListener(TRACE_LINE_EVENT, onTraceRequest);
  }, []);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-y-7 pb-9 [grid-template-areas:'head'_'line'_'search'] md:gap-y-9 md:pb-14 xl:grid-cols-[minmax(0,1fr)_28rem] xl:grid-rows-[auto_1fr] xl:gap-x-12 xl:gap-y-0 2xl:grid-cols-[minmax(0,1fr)_30rem] 2xl:gap-x-16 xl:[grid-template-areas:'head_line'_'search_line']">
      {/* A size container: the headline (text-hero) never outgrows this column (tokens.ts). */}
      <div className="@container [grid-area:head]">{heading}</div>

      <div className="max-w-[40rem] border-t border-border-subtle pt-6 [grid-area:search] xl:max-w-none xl:border-t-0 xl:pt-5">
        {lede}
        <search className="mt-6">
          <label htmlFor={searchId} className="sr-only">
            Search the demo line
          </label>
          <div
            className={cx(
              'flex min-h-[54px] items-center gap-2.5 rounded-sm border border-border-strong bg-surface-1 pr-1 pl-4 transition-colors duration-(--duration-fast) focus-within:border-fg',
              // The system's gold focus ring, on the field's frame (the input itself has none).
              'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus',
            )}
          >
            <SearchIcon size={19} className="text-fg-subtle" />
            <input
              ref={input}
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter' && results[0]) {
                  e.preventDefault();
                  trace(DEMO_LINE.indexOf(results[0]), true);
                  setQuery('');
                }
              }}
              placeholder="Search a name in any script, or a city"
              autoComplete="off"
              spellCheck={false}
              className="min-h-[52px] min-w-0 flex-1 bg-transparent text-field text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
              aria-describedby={`${searchId}-hint`}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  input.current?.focus();
                }}
                aria-label="Clear the search"
                className="inline-grid size-11 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg active:bg-surface-pressed"
              >
                <CloseIcon size={18} />
              </button>
            ) : null}
          </div>
          <p id={`${searchId}-hint`} className="mt-2 text-sm text-fg-subtle">
            Demo: searches the fictional line on this page by name, Chinese characters, Jyutping or city.
          </p>
          <p className="sr-only" aria-live="polite">
            {query.trim() && !composing ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : ''}
          </p>
          {query.trim() && !composing ? (
            results.length ? (
              <ul className="mt-2 divide-y divide-border-subtle rounded-sm border border-border-subtle bg-surface-1" aria-label="Matches in the demo line">
                {results.map((person) => (
                  <li key={person.slug}>
                    <button
                      type="button"
                      onClick={() => {
                        trace(DEMO_LINE.indexOf(person), true);
                        setQuery('');
                      }}
                      className="flex min-h-14 w-full flex-col items-start justify-center gap-0.5 px-4 py-2 text-left hover:bg-surface-3 active:bg-surface-pressed"
                    >
                      <PersonName name={person.name} original={person.original} className="font-display text-lg" />
                      <span className="text-sm text-fg-subtle">
                        {person.city} · {person.role} · from {person.startYear}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-sm border border-dashed border-border-strong px-4 py-3 text-sm text-fg-muted">
                <b className="font-semibold text-fg">No one in this line matches “{query.trim()}”.</b> Names are spelled many ways:
                try the Cantonese romanization, the Chinese characters or a city.
              </p>
            )
          ) : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-sm text-fg-subtle">
            <span className="mr-1">Try</span>
            {TRY.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => {
                  setQuery(term);
                  input.current?.focus();
                }}
                className="min-h-11 px-1.5 text-fg-muted underline decoration-border-strong underline-offset-[5px] hover:text-fg hover:decoration-current"
              >
                <span lang={/[㐀-鿿]/.test(term) ? 'zh-Hant' : /[Ѐ-ӿ]/.test(term) ? 'bg' : 'en'} translate="no">
                  {term}
                </span>
              </button>
            ))}
          </p>
        </search>
      </div>

      <figure
        ref={figure}
        id="demo-line"
        className="max-w-[40rem] scroll-mt-4 [grid-area:line] xl:row-span-2 xl:max-w-none xl:border-l xl:border-border-subtle xl:pt-1.5 xl:pl-8"
        aria-labelledby={`${searchId}-cap`}
      >
        <figcaption id={`${searchId}-cap`} className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-display text-lg">Foshan, 1868 → Sofia, 2019</span>
          <span className="eyebrow">
            {DEMO_LINE.length} people · {verifiedCount} links verified · {reviewCount} under review
          </span>
        </figcaption>

        <div className="relative">
          {/* In the rows' second column (left-16 = 4rem, after the year), which grows with the
              text like the columns do, so the spine never runs into the names at 150 % text. */}
          <svg
            className="pointer-events-none absolute top-0 left-16 z-10 overflow-visible text-fg"
            width={44}
            height={geometry.height}
            viewBox={`0 0 44 ${geometry.height}`}
            aria-hidden="true"
            data-traced={focus ?? 'none'}
          >
            {/* The pencil draft: every link, thin, in the solid dimmed tone, with ghost seals. */}
            <g data-layer="draft" style={{ color: 'var(--dim-stroke)' }}>
              {geometry.segments.map((segment) => (
                <InkShapeSvg key={segment.index} shape={segment.draft} />
              ))}
            </g>
            {geometry.segments.map((segment) => (
              <g key={`ghost-${segment.index}`} data-ghost-seal={segment.index} transform={`translate(${segment.seal.x} ${segment.seal.y})`}>
                <Seal kind={linkStyles[segment.state].seal} size={13} tone="dim" />
              </g>
            ))}

            {/* The traced path, inked over the draft (re-keyed per tap so it inks in again). */}
            <g key={run} data-layer="ink">
              {geometry.segments
                .filter((segment) => focus !== null && segment.index < focus)
                .map((segment) => (
                  <g key={segment.index}>
                    <g
                      data-state={segment.state}
                      className="animate-ink-draw"
                      style={{
                        color: `var(--${linkStyles[segment.state].strokeColor})`,
                        animationDelay: `${segment.index * step}ms`,
                      }}
                    >
                      <InkShapeSvg shape={segment.shape} />
                    </g>
                    <g transform={`translate(${segment.seal.x} ${segment.seal.y})`}>
                      <g className="animate-seal-press" style={{ animationDelay: `${segment.index * step + SEAL_DELAY}ms` }}>
                        <Seal kind={linkStyles[segment.state].seal} size={13} />
                      </g>
                    </g>
                  </g>
                ))}
            </g>

            {geometry.nodes.map((node) => {
              const person = DEMO_LINE[node.index]!;
              const dimmed = focus !== null && node.index > focus;
              const color = dimmed ? 'var(--dim-stroke)' : 'var(--fg)';
              const ring =
                focus === node.index ? (
                  <circle key={`ring-${node.index}`} cx={node.x} cy={node.y} r={8.4} fill="none" stroke="var(--fg)" strokeWidth={1.6} />
                ) : null;
              if (node.index === 0) {
                // The founder's end cap (Transit Map): a terminus bar over a square chop.
                return (
                  <g key="founder" fill={color} data-node={0}>
                    <rect x={node.x - 9} y={node.y - 11} width={18} height={3} rx={1} />
                    <rect x={node.x - 6} y={node.y - 6} width={12} height={12} rx={1.5} transform={`rotate(4 ${node.x} ${node.y})`} />
                    {focus === 0 ? <rect x={node.x - 9} y={node.y - 9} width={18} height={18} rx={2} fill="none" stroke="var(--fg)" strokeWidth={1.6} /> : null}
                  </g>
                );
              }
              return (
                <g key={node.index} data-node={node.index}>
                  {ring}
                  {person.living ? (
                    <circle cx={node.x} cy={node.y} r={4.6} fill={color} />
                  ) : (
                    // Hollow, filled with the ground behind it: the current row is tinted (surface-1).
                    <circle cx={node.x} cy={node.y} r={4.4} fill={focus === node.index ? 'var(--surface-1)' : 'var(--bg)'} stroke={color} strokeWidth={1.6} />
                  )}
                </g>
              );
            })}
          </svg>

          <ol ref={list}>
            {DEMO_LINE.map((person, i) => {
              const link = i > 0 ? DEMO_LINE_LINKS[i - 1]! : null;
              const tone = focus !== null && i > focus ? ROW_TONES.dimmed : ROW_TONES.active;
              const current = focus === i;
              return (
                <li key={person.slug} data-row>
                  <button
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    type="button"
                    aria-current={current ? 'true' : undefined}
                    onClick={() => trace(i)}
                    className={cx(
                      // items-baseline: the year sits on the baseline of the name at every text size.
                      'relative grid min-h-16 w-full grid-cols-[4rem_2.75rem_minmax(0,1fr)] content-start items-baseline rounded-sm pb-2 text-left transition-colors duration-(--duration-fast) hover:bg-surface-1',
                      // The traced person: an ink bar on the row's edge, a tint and a ring on the node.
                      current && 'bg-surface-1 before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-fg',
                    )}
                  >
                    <span className={cx('pl-3 font-display text-base tabular', tone.year)}>{person.startYear}</span>
                    <span className="col-start-3 flex min-w-0 flex-col pl-1">
                      <PersonName
                        name={person.name}
                        original={person.original}
                        data-name
                        // Phones: the original always on its own line under the name (no Cyrillic
                        // original fits beside its name at 320-399 px), so every row has the same
                        // height. From 640 px the original follows the name on its line.
                        className={cx('font-display text-md leading-[1.22] sm:text-lg sm:leading-[1.22]', tone.name)}
                        originalClassName="max-sm:basis-full"
                      />
                      <span className="mt-1 text-caption text-fg-subtle uppercase">
                        {person.city} · {person.role}
                      </span>
                      <span className="sr-only">
                        {link ? `, ${linkStyles[link.state].label} link from ${DEMO_LINE[i - 1]!.name}` : ', founder'}. Trace the line to here.
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mt-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-border-strong pt-2.5 text-sm text-fg-subtle">
          <p aria-live="polite" className="min-w-0 flex-1 basis-56">
            {focus === null
              ? 'Year each began training. The line is in pencil until you trace it: tap a name to ink it from the founder.'
              : traceSummary(focus)}
          </p>
          {previous !== null ? (
            <TrailChip
              name={DEMO_LINE[previous]!.name}
              onClick={() => {
                setTrail((t) => t.slice(0, -1));
                setRun((r) => r + 1);
              }}
            />
          ) : null}
          {focus !== null ? (
            <button
              type="button"
              onClick={() => setTrail([])}
              className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-semibold text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg"
            >
              Clear
            </button>
          ) : null}
        </div>
      </figure>
    </div>
  );
}
