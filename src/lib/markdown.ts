// A small Markdown reader for the legal documents in content/legal/ (milestone M02): front matter,
// `##`/`###` headings, paragraphs, `- ` lists and `> ` notes, with **bold**, `code` and
// [links](/path) inside them. Our own texts only, so no HTML is ever passed through.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string; id: string }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'note'; content: Inline[] };

export interface MarkdownDocument {
  meta: Record<string, string>;
  blocks: Block[];
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: 'strong', text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: 'code', text: match[2] });
    else out.push({ kind: 'link', text: match[3]!, href: match[4]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseMarkdown(source: string): MarkdownDocument {
  const meta: Record<string, string> = {};
  let body = source.replace(/\r\n/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(body);
  if (front) {
    for (const line of front[1]!.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    body = body.slice(front[0].length);
  }

  const blocks: Block[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    const first = lines[0]!;
    const heading = /^(#{2,3})\s+(.*)$/.exec(first);
    if (heading && lines.length === 1) {
      const text = heading[2]!.trim();
      blocks.push({ kind: 'heading', level: heading[1]!.length as 2 | 3, text, id: slugify(text) });
    } else if (lines.every((line) => line.startsWith('- '))) {
      blocks.push({ kind: 'list', items: lines.map((line) => parseInline(line.slice(2).trim())) });
    } else if (lines.every((line) => line.startsWith('>'))) {
      blocks.push({ kind: 'note', content: parseInline(lines.map((line) => line.replace(/^>\s?/, '')).join(' ')) });
    } else {
      blocks.push({ kind: 'paragraph', content: parseInline(lines.join(' ')) });
    }
  }
  return { meta, blocks };
}
