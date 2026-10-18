// Reads a legal document from content/legal/ (milestone M02). Public text, so the result is
// cached ('use cache'): the pages are prerendered and the file is read at build time.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseMarkdown, type MarkdownDocument } from '../../lib/markdown';
import { LEGAL_DOCUMENTS, type LegalDocument, type LegalDocumentId } from './documents';

export interface LoadedLegalDocument extends MarkdownDocument {
  document: LegalDocument;
}

export async function loadLegalDocument(id: LegalDocumentId): Promise<LoadedLegalDocument> {
  'use cache';
  const document = LEGAL_DOCUMENTS[id];
  // Scoped to content/legal, so the build traces only that folder (documents.test.ts checks that
  // `document.file` is this path).
  const source = await readFile(path.join(process.cwd(), 'content', 'legal', `${id}.en.md`), 'utf8');
  return { document, ...parseMarkdown(source) };
}
