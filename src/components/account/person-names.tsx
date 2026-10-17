// The names of the account's own person (milestone M02; plan §5.3): every name with its own
// `lang` and translate="no", Chinese in the system CJK fonts. Server component.

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
            <NameText name={name} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
