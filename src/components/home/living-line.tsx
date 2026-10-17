'use client';

// The living lineage of the home page: a demo search and an ink spine of one fictional line,
// eight generations from Foshan to Sofia. Tapping a row (or picking a search result) traces the
// line from the founder to that person: the strokes ink in one generation at a time and each
// seal is pressed after its stroke, within one second, and only after a tap (plan §5.8 (e)).
// The rows beyond the traced person take the solid dimmed tones (plan §4.7). "Back to <name>"
// returns to the previous person (the trail chip of the Constellation prototype).

import { useId, useRef, useState, type ReactNode } from 'react';
import { CloseIcon, SearchIcon } from '@/components/icons';
import { InkShapeSvg } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { spineGeometry } from '@/components/ink/spine';
import { TrailChip } from '@/components/ui/trail-chip';
import { linkStyles } from '@/design/tokens';
import { cx } from '@/lib/cx';
import { DEMO_LINE, DEMO_LINE_LINKS, searchDemoLine } from './demo-lineage';
import { PersonName } from './names';

const ROW = 56;
const geometry = spineGeometry(
  DEMO_LINE_LINKS.map((link) => link.state),
  ROW,
  12,
);
const TRY = ['盧嵐峰', 'Probnova', 'Примеров', 'Vienna'];
const verifiedCount = DEMO_LINE_LINKS.filter((link) => link.state === 'verified').length;
const reviewCount = DEMO_LINE_LINKS.length - verifiedCount;

function traceSummary(focus: number): string {
  const person = DEMO_LINE[focus]!;
  if (focus === 0) return `${person.name} founded the line in ${person.startYear}.`;
  const links = DEMO_LINE_LINKS.slice(0, focus);
  const verified = links.filter((l) => l.state === 'verified').length;
  const review = links.length - verified;
  const parts = [`${verified} verified`];
  if (review) parts.push(`${review} under review`);
  return `Traced from ${DEMO_LINE[0]!.name} to ${person.name}: ${links.length} ${links.length === 1 ? 'link' : 'links'}, ${parts.join(', ')}.`;
}

export function LivingLine({ intro }: { intro: ReactNode }) {
  const [trail, setTrail] = useState<number[]>([]);
  const [run, setRun] = useState(0);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const searchId = useId();

  const focus = trail.length ? trail[trail.length - 1]! : null;
  const previous = trail.length > 1 ? trail[trail.length - 2]! : null;
  const results = composing ? [] : searchDemoLine(query);
  const step = focus ? Math.min(110, Math.floor((1000 - 220) / focus)) : 110;

  const trace = (index: number, moveFocus = false) => {
    setTrail((t) => (t[t.length - 1] === index ? t : [...t, index].slice(-12)));
    setRun((r) => r + 1);
    if (moveFocus) {
      const row = rows.current[index];
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <div className="grid gap-8 pb-9 md:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] md:items-start md:gap-12 md:pb-14 lg:gap-16">
      <div>
        {intro}
        <search className="mt-6">
          <label htmlFor={searchId} className="sr-only">
            Search the demo line
          </label>
          <div className="flex min-h-[54px] items-center gap-2.5 rounded-sm border border-border-strong bg-surface-1 pr-1 pl-4 transition-colors duration-(--duration-fast) focus-within:border-fg">
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
              className="min-h-[52px] min-w-0 flex-1 bg-transparent text-[1rem] text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
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
                className="inline-grid size-11 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                <CloseIcon size={18} />
              </button>
            ) : null}
          </div>
          <p id={`${searchId}-hint`} className="mt-2 text-[0.8125rem] text-fg-subtle">
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
                      className="flex min-h-14 w-full flex-col items-start justify-center gap-0.5 px-4 py-2 text-left hover:bg-surface-3"
                    >
                      <PersonName name={person.name} original={person.original} className="font-display text-lg" />
                      <span className="text-[0.8125rem] text-fg-subtle">
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
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-[0.8125rem] text-fg-subtle">
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

      <figure className="border-t border-border-subtle pt-5 md:border-t-0 md:border-l md:pt-1.5 md:pl-8" aria-labelledby={`${searchId}-cap`}>
        <figcaption id={`${searchId}-cap`} className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-display text-lg">Foshan, 1868 → Sofia, 2019</span>
          <span className="eyebrow">
            8 generations · {verifiedCount} verified · {reviewCount} under review
          </span>
        </figcaption>

        <div className="relative">
          <svg
            className="pointer-events-none absolute top-0 left-[58px] overflow-visible text-fg"
            width={44}
            height={geometry.height}
            viewBox={`0 0 44 ${geometry.height}`}
            aria-hidden="true"
            key={run}
          >
            {geometry.segments.map((segment) => {
              const traced = focus !== null && segment.index < focus;
              const dimmed = focus !== null && segment.index >= focus;
              return (
                <g
                  key={segment.index}
                  data-state={segment.state}
                  className={cx(traced && 'animate-ink-draw')}
                  style={{
                    color: dimmed ? 'var(--dim-stroke)' : undefined,
                    animationDelay: traced ? `${segment.index * step}ms` : undefined,
                  }}
                >
                  <InkShapeSvg shape={segment.shape} />
                </g>
              );
            })}
            {geometry.nodes.map((node) => {
              const person = DEMO_LINE[node.index]!;
              const dimmed = focus !== null && node.index > focus;
              const color = dimmed ? 'var(--dim-stroke)' : 'var(--fg)';
              if (node.index === 0) {
                // The founder's end cap (Transit Map): a terminus bar over a square chop.
                return (
                  <g key="founder" fill={color}>
                    <rect x={node.x - 9} y={node.y - 11} width={18} height={3} rx={1} />
                    <rect x={node.x - 6} y={node.y - 6} width={12} height={12} rx={1.5} transform={`rotate(4 ${node.x} ${node.y})`} />
                  </g>
                );
              }
              return person.living ? (
                <circle key={node.index} cx={node.x} cy={node.y} r={4.6} fill={color} />
              ) : (
                <circle key={node.index} cx={node.x} cy={node.y} r={4.4} fill="var(--bg)" stroke={color} strokeWidth={1.6} />
              );
            })}
            {geometry.segments.map((segment) => {
              const traced = focus !== null && segment.index < focus;
              return (
                <g key={`seal-${segment.index}`} transform={`translate(${segment.seal.x} ${segment.seal.y})`}>
                  <g
                    className={cx(traced && 'animate-seal-press')}
                    style={{ animationDelay: traced ? `${segment.index * step + 130}ms` : undefined }}
                  >
                    <Seal kind={linkStyles[segment.state].seal} size={13} />
                  </g>
                </g>
              );
            })}
          </svg>

          <ol>
            {DEMO_LINE.map((person, i) => {
              const link = i > 0 ? DEMO_LINE_LINKS[i - 1]! : null;
              const dimmed = focus !== null && i > focus;
              return (
                <li key={person.slug}>
                  <button
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    type="button"
                    aria-pressed={focus === i}
                    onClick={() => trace(i)}
                    className={cx(
                      'grid h-14 w-full grid-cols-[58px_44px_minmax(0,1fr)] rounded-sm text-left transition-colors duration-(--duration-fast) hover:bg-surface-1',
                      focus === i && 'bg-surface-1',
                    )}
                  >
                    <span className={cx('pt-0.5 font-display text-base tabular', dimmed ? 'text-fg-muted' : 'text-fg-subtle')}>
                      {person.startYear}
                    </span>
                    <span className="col-start-3 flex min-w-0 flex-col pl-1">
                      <PersonName
                        name={person.name}
                        original={person.original}
                        // Phones: a size at which a Latin name and its original fit one line.
                        className={cx(
                          'font-display text-[1.0625rem] leading-[1.22] sm:text-[1.1875rem]',
                          dimmed ? 'text-fg-muted' : 'text-fg',
                        )}
                      />
                      <span className="mt-px text-[0.6875rem] leading-tight font-semibold tracking-[0.14em] text-fg-subtle uppercase">
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

        <div className="mt-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-border-strong pt-2.5 text-[0.8125rem] text-fg-subtle">
          <p aria-live="polite" className="min-w-0 flex-1 basis-56">
            {focus === null ? 'Year each began training. Tap a name to trace the line from the founder.' : traceSummary(focus)}
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
              className="inline-flex min-h-11 items-center rounded-sm px-2 text-[0.8125rem] font-semibold text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg"
            >
              Clear
            </button>
          ) : null}
        </div>
      </figure>
    </div>
  );
}
