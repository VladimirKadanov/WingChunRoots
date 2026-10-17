// A legal document page (milestone M02): /legal/terms and /legal/privacy, rendered from
// content/legal/*.en.md. The draft note comes first and stays visible (DEFAULT D23).

import Link from 'next/link';
import type { Block, Inline } from '@/lib/markdown';

function Inlines({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((part, i) => {
        if (part.kind === 'strong') return <strong key={i} className="font-semibold text-fg">{part.text}</strong>;
        if (part.kind === 'code') {
          return (
            <code key={i} translate="no" className="rounded-xs bg-surface-2 px-1 font-mono text-[0.92em]">
              {part.text}
            </code>
          );
        }
        if (part.kind === 'link') {
          return part.href.startsWith('/') ? (
            <Link key={i} href={part.href} className="link">
              {part.text}
            </Link>
          ) : (
            <a key={i} href={part.href} className="link" rel="noreferrer">
              {part.text}
            </a>
          );
        }
        return part.text;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 id={block.id} className="mt-6 border-t border-border-subtle pt-6 font-display text-2xl first:mt-0">
          {block.text}
        </h2>
      ) : (
        <h3 id={block.id} className="mt-2 font-display text-xl">
          {block.text}
        </h3>
      );
    case 'list':
      return (
        <ul className="grid list-disc gap-2 pl-6 marker:text-fg-subtle">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines content={item} />
            </li>
          ))}
        </ul>
      );
    case 'note':
      return (
        <div role="note" className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui text-fg">
          <p>
            <Inlines content={block.content} />
          </p>
        </div>
      );
    default:
      return (
        <p>
          <Inlines content={block.content} />
        </p>
      );
  }
}

export function LegalPage({ title, version, blocks }: { title: string; version: string; blocks: Block[] }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-12 md:pt-11">
      <article className="max-w-[44rem]">
        <p className="eyebrow">Legal · version {version}</p>
        <h1 className="mt-2 font-display text-feature">{title}</h1>
        <div className="mt-6 grid gap-4 text-base leading-relaxed text-fg-muted">
          {blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </div>
      </article>
    </div>
  );
}
