// The names of the account's own person (milestone M02; plan §5.3): every name with its own
// `lang` and translate="no", Chinese in the system CJK fonts. No hooks: the onboarding form (a
// client component) uses them too.

import { cx } from '@/lib/cx';

export interface NameView {
  value: string;
  lang: string;
  kind: string;
  romanization: string | null;
  isPrimary: boolean;
}

const isChinese = (lang: string) => lang === 'zh' || lang.startsWith('zh-') || lang === 'yue' || lang.startsWith('yue-Han');

/** One name, never translated, in its own language. */
export function NameText({ name, className }: { name: Pick<NameView, 'value' | 'lang'>; className?: string }) {
  return (
    <span lang={name.lang} translate="no" className={cx(isChinese(name.lang) && !name.lang.includes('Latn') && 'cjk', className)}>
      {name.value}
    </span>
  );
}

/**
 * A person's names as the register shows them (the home page's lineage rows): the Latin-script
 * name in the display face, the original script beside it, smaller, and the readings beneath.
 */
export function NameLine({
  primary,
  original,
  readings = [],
  className,
}: {
  primary: string;
  original?: Pick<NameView, 'value' | 'lang'> | null;
  readings?: readonly Pick<NameView, 'value' | 'lang'>[];
  className?: string;
}) {
  return (
    <span className={cx('grid gap-1', className)}>
      <span className="inline-flex flex-wrap items-baseline gap-x-[0.42em] font-display">
        <NameText name={{ value: primary, lang: 'und-Latn' }} />
        {original?.value ? <NameText name={original} className="text-[0.74em] text-fg-muted" /> : null}
      </span>
      {readings.length > 0 ? (
        // tracking-normal: a display size above sets a tight letter spacing in px, which inherits.
        <span className="flex flex-wrap gap-x-3 font-sans text-sm tracking-normal text-fg-muted">
          {readings.map((reading) => (
            <NameText key={reading.lang} name={reading} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** The labelled list of a person's names: primary, original script, Jyutping, pinyin. */
export function NameList({ names }: { names: readonly NameView[] }) {
  const rows = names.map((name) => ({
    name,
    label: name.isPrimary
      ? 'Name'
      : name.kind === 'romanization'
        ? name.romanization === 'jyutping'
          ? 'Jyutping'
          : name.romanization === 'pinyin'
            ? 'Pinyin'
            : 'Romanization'
        : 'Original script',
  }));
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)]">
      {rows.map(({ name, label }) => (
        <div key={`${label}-${name.lang}`} className="contents">
          <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">{label}</dt>
          <dd className="border-b border-border-subtle pb-3 text-lg sm:border-t sm:border-b-0 sm:pt-3">
            <NameText name={name} className="font-display" />
          </dd>
        </div>
      ))}
    </dl>
  );
}
