// The legal documents of the pilot and the version that every consent records (milestone M02).
// DEFAULT D23: the texts in content/legal/ are drafts marked "Draft — pending legal review" until
// the owner commissions a legal review (plan §10.1, row 11). A new version of a document changes
// `version` here and in the document's front matter (documents.test.ts compares them); consents
// given for an older version stay recorded with that version.

import type { CONSENT_KINDS } from '../db/schema/common';

export type LegalDocumentId = 'terms' | 'privacy';
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  /** Path from the repository root. */
  file: string;
  /** Recorded in consent_record.document_version. */
  version: string;
  /** The public route that shows it. */
  path: string;
}

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  terms: {
    id: 'terms',
    title: 'Terms of use',
    file: 'content/legal/terms.en.md',
    version: '2026-10-17-draft',
    path: '/legal/terms',
  },
  privacy: {
    id: 'privacy',
    title: 'Privacy notice',
    file: 'content/legal/privacy.en.md',
    version: '2026-10-17-draft',
    path: '/legal/privacy',
  },
};

/**
 * Which document each consent refers to. The adult confirmation and the authenticity declaration
 * are sections of the terms (DEFAULT D10: adults only); the publication of one's own profile is
 * described in the privacy notice.
 */
export const CONSENT_DOCUMENT: Record<ConsentKind, LegalDocumentId> = {
  terms: 'terms',
  privacy_ack: 'privacy',
  authenticity_declaration: 'terms',
  age_18_plus: 'terms',
  publication: 'privacy',
};

/** The four ticks of the sign-up form, none of them ticked in advance. */
export const SIGN_UP_CONSENTS = ['terms', 'privacy_ack', 'authenticity_declaration', 'age_18_plus'] as const satisfies readonly ConsentKind[];
export type SignUpConsent = (typeof SIGN_UP_CONSENTS)[number];

/**
 * The ticks without which sign-up is refused (milestone M02, In scope 4): the adult confirmation
 * (DEFAULT D10: the pilot is for adults only), the terms and the authenticity declaration. The
 * privacy acknowledgement is recorded when it is ticked; the privacy notice applies either way.
 */
export const REQUIRED_SIGN_UP_CONSENTS = ['terms', 'authenticity_declaration', 'age_18_plus'] as const satisfies readonly SignUpConsent[];

export function consentVersion(kind: ConsentKind): string {
  return LEGAL_DOCUMENTS[CONSENT_DOCUMENT[kind]].version;
}
