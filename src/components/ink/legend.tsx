// The always-visible legend (from the Constellation prototype): every link state as its stroke,
// its seal and its name, so the drawing never depends on colour (plan §4.6). Shared by the home
// page, the lineage screens (M04) and the explorer (M05); a screen may name a state in its own
// words (`labels`), never draw it differently: its samples are drawn the way the screen draws its
// links, in ink (the home page, the lineage screens) or as the explorer's canvas draws them at
// its level of detail (`strokes="canvas"`: both of its samples, ink and plain stroke, and the
// canvas shows the one it draws at its zoom: globals.css, Ink restyle).

import { linkStyles } from '@/design/tokens';
import { cx } from '@/lib/cx';
import { LinkStroke, type LinkKind } from './link-stroke';
import { Seal } from './seal';

const ORDER: LinkKind[] = ['verified', 'under_review', 'unconfirmed', 'arbitration', 'cross_lineage', 'historical'];

/** The kinds a drawing actually uses, in legend order: a legend lists only what is drawn. */
export function legendKinds(drawn: Iterable<LinkKind>): LinkKind[] {
  const set = new Set(drawn);
  return ORDER.filter((kind) => set.has(kind));
}

export interface LegendWording {
  label: string;
  description: string;
}

export function Legend({
  kinds = ORDER,
  layout = 'wrap',
  descriptions = false,
  labels = {},
  strokes = 'ink',
  className,
}: {
  kinds?: LinkKind[];
  /** 'adaptive': wrapped in a row on a phone, one per line with room from 1280 px (a side rail). */
  layout?: 'wrap' | 'list' | 'adaptive';
  /** 'xl': the descriptions only from 1280 px, where the key has a column of its own. */
  descriptions?: boolean | 'xl';
  /** A screen's own words for a state (the lineage screens call the dotted state "Pending"). */
  labels?: Partial<Record<LinkKind, LegendWording>>;
  /**
   * How the screen draws its links: in ink, or as the explorer's canvas does (its ink and its plain
   * strokes, of which the canvas frame shows the one its level of detail draws).
   */
  strokes?: 'ink' | 'canvas';
  className?: string;
}) {
  return (
    <ul
      aria-label="Legend: link states"
      className={cx(
        layout === 'wrap' && 'flex flex-wrap gap-x-5 gap-y-2',
        layout === 'list' && 'grid gap-3',
        layout === 'adaptive' && 'flex flex-wrap gap-x-5 gap-y-2 xl:grid xl:gap-3',
        className,
      )}
    >
      {kinds.map((kind) => {
        const style = linkStyles[kind];
        const words = labels[kind] ?? style;
        return (
          <li
            key={kind}
            className={cx('flex gap-2', descriptions === true && 'items-start', !descriptions && 'items-center', descriptions === 'xl' && 'items-center xl:items-start')}
          >
            {strokes === 'canvas' ? (
              <>
                <LinkStroke kind={kind} variant="canvas-ink" width={34} />
                <LinkStroke kind={kind} variant="canvas" width={34} />
              </>
            ) : (
              <LinkStroke kind={kind} variant={strokes} width={34} className={cx(descriptions === true && 'mt-1', descriptions === 'xl' && 'xl:mt-1')} />
            )}
            <Seal kind={style.seal} size={15} className={cx(descriptions === true && 'mt-0.5', descriptions === 'xl' && 'xl:mt-0.5')} />
            <span className="text-sm text-fg">
              <span className="font-semibold">{words.label}</span>
              {descriptions ? (
                <span className={cx('text-fg-muted', descriptions === 'xl' ? 'hidden xl:block' : 'block')}>{words.description}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
