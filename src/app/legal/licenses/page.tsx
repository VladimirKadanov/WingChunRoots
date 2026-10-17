// /legal/licenses (plan §4.14, §5.5): the third-party licences of everything WingChunRoots
// ships, generated with THIRD_PARTY_NOTICES.md by `pnpm notices`.

import type { Metadata } from 'next';
import { ChevronDownIcon } from '@/components/icons';
import notices from './notices.json';

export const metadata: Metadata = {
  title: 'Licenses',
  description: 'Open-source licences of the software and fonts WingChunRoots uses.',
};

interface Notice {
  name: string;
  version: string;
  license: string;
  author: string | null;
  homepage: string | null;
  text: string | null;
}

const URL_PATTERN = /(https?:\/\/[^\s<>)]+)/g;

/** Plain text with its URLs as links (the addenda are short Markdown files). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} className="link break-all">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export default function LicensesPage() {
  const groups = new Map<string, Notice[]>();
  for (const notice of notices.notices as Notice[]) {
    groups.set(notice.license, [...(groups.get(notice.license) ?? []), notice]);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  return (
    <div className="mx-auto max-w-content px-[max(1rem,env(safe-area-inset-left,0px))] pt-6 pb-12 md:px-10 md:pt-11">
      <p className="eyebrow">Legal</p>
      <h1 className="mt-2 font-display text-feature">Licenses</h1>
      <p className="mt-3 max-w-[62ch] text-fg-muted">
        WingChunRoots is built on open-source software and fonts. These are the {notices.notices.length} packages it ships to your
        browser or runs on its server, with their licences, followed by notices that need more than a licence name. Development
        tools are not distributed and are not listed.
      </p>

      <section aria-labelledby="addenda-heading" className="mt-10 border-t border-border-subtle pt-8">
        <h2 id="addenda-heading" className="font-display text-2xl">
          Additional notices
        </h2>
        <div className="mt-4 grid gap-4">
          {notices.addenda.map((addendum) => {
            const [summary, ...rest] = addendum.body.split(/\n---\n/);
            return (
              <article key={addendum.file} className="min-w-0 rounded-md border border-border-subtle bg-surface-1 p-4 md:p-6">
                <h3 className="font-display text-xl">{addendum.title}</h3>
                <div className="mt-3 max-w-[78ch] text-sm leading-relaxed whitespace-pre-wrap text-fg-muted [overflow-wrap:anywhere]">
                  <Linkified text={summary ?? ''} />
                </div>
                {rest.length ? (
                  <details className="group mt-3">
                    <summary className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-fg">
                      Full licence text
                      <ChevronDownIcon size={18} className="text-fg-subtle transition-transform duration-(--duration-fast) group-open:rotate-180" />
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded-sm bg-surface-2 p-3 font-mono text-[0.75rem] whitespace-pre-wrap text-fg-muted [overflow-wrap:anywhere]">
                      {rest.join('\n---\n').trim()}
                    </pre>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="packages-heading" className="mt-10 border-t border-border-subtle pt-8">
        <h2 id="packages-heading" className="font-display text-2xl">
          Packages by licence
        </h2>
        <div className="mt-4 grid gap-8">
          {sorted.map(([license, items]) => (
            <section key={license} aria-label={`${license}: ${items.length} packages`}>
              <h3 className="flex items-baseline gap-2 border-b border-border-strong pb-2 text-sm font-semibold">
                {license}
                <span className="font-normal text-fg-subtle">
                  {items.length} {items.length === 1 ? 'package' : 'packages'}
                </span>
              </h3>
              <ul className="divide-y divide-border-subtle">
                {items.map((item) => (
                  <li key={`${item.name}@${item.version}`}>
                    <details className="group">
                      <summary className="flex min-h-11 flex-wrap items-center gap-x-3 py-1 text-sm [overflow-wrap:anywhere]">
                        <span className="font-semibold" translate="no">
                          {item.name}
                        </span>
                        <span className="text-fg-subtle tabular">{item.version}</span>
                        {item.author ? <span className="text-fg-subtle">{item.author}</span> : null}
                        <ChevronDownIcon size={18} className="ml-auto text-fg-subtle transition-transform duration-(--duration-fast) group-open:rotate-180" />
                      </summary>
                      <div className="pb-4">
                        {item.homepage ? (
                          <p className="text-sm">
                            <a href={item.homepage} className="link inline-flex min-h-11 items-center break-all">
                              {item.homepage}
                            </a>
                          </p>
                        ) : null}
                        {item.text ? (
                          <pre className="mt-1 max-h-80 overflow-auto rounded-sm bg-surface-1 p-3 font-mono text-[0.75rem] whitespace-pre-wrap text-fg-muted [overflow-wrap:anywhere]">
                            {item.text}
                          </pre>
                        ) : (
                          <p className="text-sm text-fg-muted">The package ships no licence file; its package.json declares {license}.</p>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
