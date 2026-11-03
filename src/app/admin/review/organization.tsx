// The organization of an application case on the case card (milestone M15): the official name,
// kind, headquarters, website, leader and the number of schools the application gives, and its
// approval. DEFAULT D04: approving it gives no plan and verifies nobody; the card says so. The
// supporting document is in the case's Evidence section (private, DEFAULT D13/D25).

import type { OrganizationCaseView } from '@/server/services/organization-review';

export function OrganizationSection({ organization }: { organization: OrganizationCaseView }) {
  const rows: [string, string | null][] = [
    ['Kind', organization.kindLabel],
    ['Headquarters', organization.countryName ?? organization.countryCode],
    ['Website', organization.websiteUrl],
    ['Leader', organization.leaderName ? `${organization.leaderName}${organization.leaderTitle ? `, ${organization.leaderTitle}` : ''}` : null],
    ['Schools (approximate)', organization.schoolsEstimate === null ? null : String(organization.schoolsEstimate)],
    ['Approval', organization.approvalLabel],
  ];
  return (
    <section id="organization" aria-labelledby="organization-heading" className="grid content-start gap-3 border-t border-border-subtle pt-6" data-testid="case-organization-card">
      <h2 id="organization-heading" className="font-display text-2xl">
        The organization
      </h2>
      <p className="font-display text-xl [overflow-wrap:anywhere]">{organization.name}</p>
      <dl className="grid gap-2 text-ui sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm text-fg-muted">{label}</dt>
            <dd className="[overflow-wrap:anywhere]" translate={label === 'Website' || label === 'Leader' ? 'no' : undefined}>
              {value ?? <span className="text-fg-muted">Not given</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="max-w-[60ch] text-sm text-fg-muted">
        Approval puts the organization’s page online. It gives no plan, and it verifies no teacher, member or relationship: those stay separate.
      </p>
    </section>
  );
}
