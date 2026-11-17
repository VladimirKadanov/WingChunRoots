// Shared parts of the archive editor's pages (milestone M26): one record as a line of a list, with
// its state in words (never by colour alone).

import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import type { ArchiveRecordRef } from '@/server/services/archive-editor';

/** A record's state in words (never by colour alone). */
export function recordFacts(r: ArchiveRecordRef): string {
  const life = r.lifeStatus === 'deceased' ? 'Deceased' : r.lifeStatus === 'living' ? 'Living' : 'Life status not known';
  const kept = r.stewardship === 'self' ? 'Member’s own record' : r.kind === 'historical' ? 'Historical record' : 'Record kept by the platform';
  return `${kept} · ${life} · ${r.shown ? 'Public' : 'Not public'}`;
}

export function RecordLine({ record, children }: { record: ArchiveRecordRef; children?: ReactNode }) {
  return (
    <li className="grid gap-1 border-b border-border-subtle py-3" data-record={record.slug}>
      <span className="flex flex-wrap items-baseline gap-x-3">
        <NameText name={record.name} className="font-semibold" />
        {record.original ? <NameText name={record.original} /> : null}
        <code className="text-sm text-fg-muted" translate="no">
          {record.slug}
        </code>
      </span>
      <span className="text-sm text-fg-muted">{recordFacts(record)}</span>
      <span className="flex flex-wrap gap-x-4">
        <Link href={`/admin/review/records/${record.slug}`} className="link inline-flex min-h-11 items-center">
          Open the record
        </Link>
        {children}
      </span>
    </li>
  );
}
