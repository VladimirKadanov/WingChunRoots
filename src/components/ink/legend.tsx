// The always-visible legend (from the Constellation prototype): every link state as its stroke,
// its seal and its name, so the drawing never depends on colour (plan §4.6).

import { linkStyles } from '@/design/tokens';
import { cx } from '@/lib/cx';
import { LinkStroke, type LinkKind } from './link-stroke';
import { Seal } from './seal';

const ORDER: LinkKind[] = ['verified', 'under_review', 'unconfirmed', 'arbitration', 'cross_lineage', 'historical'];

export function Legend({
  kinds = ORDER,
  layout = 'wrap',
  descriptions = false,
  className,
}: {
  kinds?: LinkKind[];
  layout?: 'wrap' | 'list';
  descriptions?: boolean;
  className?: string;
}) {
  return (
    <ul
      aria-label="Legend: link states"
      className={cx(layout === 'wrap' ? 'flex flex-wrap gap-x-5 gap-y-2' : 'grid gap-3', className)}
    >
      {kinds.map((kind) => {
        const style = linkStyles[kind];
        return (
          <li key={kind} className={cx('flex gap-2', descriptions ? 'items-start' : 'items-center')}>
            <LinkStroke kind={kind} width={34} className={cx(descriptions && 'mt-1')} />
            <Seal kind={style.seal} size={15} className={cx(descriptions && 'mt-0.5')} />
            <span className="text-[0.8125rem] text-fg">
              <span className="font-semibold">{style.label}</span>
              {descriptions ? <span className="block text-fg-muted">{style.description}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
