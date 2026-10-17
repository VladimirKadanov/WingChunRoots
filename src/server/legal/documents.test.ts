// The legal drafts (milestone M02, In scope 4; DEFAULT D23): each file carries the version that
// consents record, says it is a draft pending legal review, and says what the milestone requires.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from '../../lib/markdown';
import { CONSENT_DOCUMENT, consentVersion, LEGAL_DOCUMENTS, REQUIRED_SIGN_UP_CONSENTS, SIGN_UP_CONSENTS } from './documents';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('legal documents', () => {
  for (const document of Object.values(LEGAL_DOCUMENTS)) {
    it(`${document.file} has the version and title of documents.ts and the draft note`, () => {
      expect(document.file).toBe(`content/legal/${document.id}.en.md`);
      const parsed = parseMarkdown(read(document.file));
      expect(parsed.meta.version).toBe(document.version);
      expect(parsed.meta.title).toBe(document.title);
      expect(parsed.blocks[0]).toMatchObject({ kind: 'note' });
      expect(JSON.stringify(parsed.blocks[0])).toContain('Draft — pending legal review.');
    });
  }

  it('the terms say the pilot is for adults only, without a birth date', () => {
    const terms = read(LEGAL_DOCUMENTS.terms.file);
    expect(terms).toMatch(/Adults only/);
    expect(terms).toMatch(/\*\*18 or older\*\*/);
    expect(terms).toMatch(/do not ask for your birth date/);
    expect(terms).toMatch(/Authenticity declaration/);
  });

  it('the privacy notice lists the recipients and describes ip_hmac', () => {
    const privacy = read(LEGAL_DOCUMENTS.privacy.file);
    expect(privacy).toMatch(/OpenFreeMap/);
    expect(privacy).toMatch(/Hosting, e-mail and monitoring providers/);
    expect(privacy).toMatch(/`ip_hmac`/);
    expect(privacy).toMatch(/HMAC-SHA-256/);
  });

  it('every sign-up consent refers to a document version; the required ticks are age, terms and authenticity', () => {
    for (const kind of SIGN_UP_CONSENTS) expect(consentVersion(kind)).toBe(LEGAL_DOCUMENTS[CONSENT_DOCUMENT[kind]].version);
    expect([...REQUIRED_SIGN_UP_CONSENTS].sort()).toEqual(['age_18_plus', 'authenticity_declaration', 'terms']);
  });
});

describe('parseMarkdown', () => {
  it('reads front matter, headings, lists, notes and paragraphs', () => {
    const doc = parseMarkdown('---\nversion: v1\n---\n\n> **Note.** x\n\n## A heading\n\n- one\n- two `code`\n\nText with [a link](/legal/terms).\n');
    expect(doc.meta).toEqual({ version: 'v1' });
    expect(doc.blocks.map((b) => b.kind)).toEqual(['note', 'heading', 'list', 'paragraph']);
    expect(doc.blocks[1]).toEqual({ kind: 'heading', level: 2, text: 'A heading', id: 'a-heading' });
  });

  it('never passes HTML through: tags stay text', () => {
    expect(parseInline('<script>x</script> **b**')).toEqual([
      { kind: 'text', text: '<script>x</script> ' },
      { kind: 'strong', text: 'b' },
    ]);
  });
});
