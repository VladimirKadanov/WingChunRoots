// /legal/privacy (milestone M02, In scope 4): the draft from content/legal/privacy.en.md
// (DEFAULT D23: "Draft — pending legal review" until the owner commissions a legal review).

import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_DOCUMENTS } from '@/server/legal/documents';
import { loadLegalDocument } from '@/server/legal/load';

export const metadata: Metadata = {
  title: LEGAL_DOCUMENTS.privacy.title,
  description: 'Draft, pending legal review: the privacy notice of the WingChunRoots pilot.',
};

export default async function PrivacyPage() {
  const { document, blocks } = await loadLegalDocument('privacy');
  return <LegalPage title={document.title} version={document.version} blocks={blocks} />;
}
