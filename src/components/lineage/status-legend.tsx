// The key of the lineage screens (plan §4.6; milestone M04, shared with the explorer of M05):
// each state that the page shows, as its stroke, its seal and its name, so nothing depends on
// colour. A request only its participants can see reads "Pending" (DEFAULT D03).

import type { LinkKind } from '@/components/ink/link-stroke';
import { LinkStroke } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { linkStyles } from '@/design/tokens';
import { cx } from '@/lib/cx';

const ORDER: LinkKind[] = ['verified', 'under_review', 'unconfirmed', 'arbitration', 'cross_lineage', 'historical'];

const WORDING: Partial<Record<LinkKind, { label: string; description: string }>> = {
  unconfirmed: { label: 'Pending', description: 'A request the teacher has not answered. Only the two people in it can see it.' },
};

export function StatusLegend({ kinds, className, id = 'status-key' }: { kinds: Iterable<LinkKind>; className?: string; id?: string }) {
  const shown = new Set(kinds);
  const list = ORDER.filter((kind) => shown.has(kind));
  if (list.length === 0) return null;
  return (
    <section aria-labelledby={id} className={cx('rounded-sm border border-border-subtle bg-surface-1 px-4 py-3 [--seal-ground:var(--surface-1)]', className)}>
      <h2 id={id} className="eyebrow">
        Key
      </h2>
      <ul className="mt-2 grid gap-2.5 sm:grid-cols-2">
        {list.map((kind) => {
          const style = linkStyles[kind];
          const words = WORDING[kind] ?? { label: style.label, description: style.description };
          return (
            <li key={kind} className="flex items-start gap-2">
              <LinkStroke kind={kind} width={30} className="mt-1.5" />
              <Seal kind={style.seal} size={16} className="mt-0.5" />
              <span className="text-sm">
                <span className="font-semibold text-fg">{words.label}</span>
                <span className="block text-fg-muted">{words.description}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
