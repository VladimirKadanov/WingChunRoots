// The impersonation report on the case card (ADR 0088; specification §16.1): what kind of report it
// is, the proof route the reporter chose, the hold and its dates, and the proof each side brought:
// who was asked to vouch and how they answered (with their note), and the codes sent to a school's
// own e-mail or posted on its page. An administrator confirms seeing a posted code here
// (identity.checkCode). The files (a private video among them) are in the case's Evidence section.

import type { AdminT } from '@/components/admin/i18n/translate';
import type { FormState } from '@/lib/form-state';
import { PersonName } from '@/components/relationships/parts';
import type { IdentityCaseView, IdentityProofSummary } from '@/server/services/identity-reports';
import { CheckCodeForm } from './forms';

/** Decision 6: one verified teacher said yes, or two verified members who share no teacher. */
function vouchingWords(t: AdminT, c: IdentityProofSummary['counts']): string {
  const base =
    c.teachersYes > 0
      ? t.n(c.teachersYes, 'Enough: {n} verified teacher said yes', 'Enough: {n} verified teachers said yes')
      : c.independent
        ? t('Enough: {n} verified members said yes, from different schools', { n: c.peersYes })
        : c.peersYes > 1
          ? t('Not enough yet: {n} members said yes, but they share a teacher', { n: c.peersYes })
          : c.asked > 0
            ? t('Not enough yet: {answered} of {asked} answered', { answered: c.answered, asked: c.asked })
            : t('Nobody asked yet');
  return c.noes > 0 ? `${base} · ${t.n(c.noes, '{n} said no', '{n} said no')}` : base;
}

function channelWords(t: AdminT, c: IdentityProofSummary['counts']): string {
  return c.confirmedCodes > 0 ? t('Confirmed ({n})', { n: c.confirmedCodes }) : c.codes > 0 ? t('Asked, not confirmed yet') : t('None');
}

export function IdentitySection({ caseId, identity, codeResults, t }: { caseId: string; identity: IdentityCaseView; codeResults: Map<string, FormState>; t: AdminT }) {
  const sides = [
    ['reporter', t('The reporter')],
    ['reported', t('The account that holds the profile')],
  ] as const;
  return (
    <section id="identity" aria-labelledby="identity-heading" className="grid min-w-0 content-start gap-4 border-t border-border-subtle pt-6" data-testid="case-identity" data-type={identity.type} data-status={identity.status}>
      <h2 id="identity-heading" className="font-display text-2xl">
        {t('The impersonation report')}
      </h2>
      <dl className="grid gap-2 text-ui sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="contents">
          <dt className="text-fg-muted">{t('Report')}</dt>
          <dd>{t(identity.typeLabel)}</dd>
        </div>
        <div className="contents">
          <dt className="text-fg-muted">{t('Proof route')}</dt>
          <dd>{t(identity.routeLabel)}</dd>
        </div>
        <div className="contents">
          <dt className="text-fg-muted">{t('Status')}</dt>
          <dd data-testid="identity-status">{t(identity.statusLabel)}</dd>
        </div>
        {identity.heldAt ? (
          <div className="contents">
            <dt className="text-fg-muted">{t('Held')}</dt>
            <dd>
              {t('since {day}', { day: t.day(identity.heldAt) })}
              {identity.proofDueAt ? ` · ${t('proof due {day}', { day: t.day(identity.proofDueAt) })}` : ''}
              {identity.holdUntil ? ` · ${t('the hold lifts by itself on {day}', { day: t.day(identity.holdUntil) })}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
      {identity.reporterHasProfile ? (
        <p className="max-w-[60ch] rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui" data-testid="identity-reporter-has-profile">
          <span className="font-semibold">{t('Note:')}</span> {t('The reporter now has a profile of their own, so upholding this report cannot move the profile to them. Ask them, or take the copy down instead.')}
        </p>
      ) : null}
      {identity.reportedSuspended ? <p className="max-w-[60ch] text-ui text-fg-muted">{t('The account that holds the profile is suspended already.')}</p> : null}
      {!identity.heldAt && identity.status === 'open' ? (
        <p className="max-w-[60ch] text-ui text-fg-muted">{t('Nothing has changed for the profile yet. Its account is told only once a moderator holds the profile, and never who reported it.')}</p>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        {sides.map(([side, title]) => {
          const s = identity.sides[side];
          return (
            <div key={side} className="grid content-start gap-3 rounded-md border border-border-subtle bg-surface-1 p-4" data-testid={`identity-side-${side}`}>
              <h3 className="font-semibold">{title}</h3>
              <dl className="grid gap-1 text-ui sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-4">
                <dt className="text-fg-muted">{t('Vouching')}</dt>
                <dd data-testid="identity-proof-vouching">{vouchingWords(t, s.proof.counts)}</dd>
                <dt className="text-fg-muted">{t('Own channel')}</dt>
                <dd>{channelWords(t, s.proof.counts)}</dd>
                <dt className="text-fg-muted">{t('Files')}</dt>
                <dd>{s.proof.files === 0 ? t('None') : t.num(s.proof.files)}</dd>
              </dl>
              {s.vouches.length > 0 ? (
                <ul className="grid gap-3" data-testid="identity-vouches">
                  {s.vouches.map((v) => (
                    <li key={v.id} className="grid gap-1 border-l-4 border-border-subtle pl-3" data-testid="identity-vouch" data-answer={v.answer ?? 'asked'}>
                      <PersonName person={v.voucher} />
                      <span className="text-sm text-fg-muted">
                        {t(v.kindLabel)} · {t('asked {day}', { day: t.day(v.askedAt) })}
                      </span>
                      {v.message ? <span className="text-sm whitespace-pre-line">{t('Their message: {message}', { message: v.message })}</span> : null}
                      {v.answer ? (
                        <span className="text-ui">
                          <span className="font-semibold">{t(v.answerLabel!)}</span> <span className="text-fg-muted">· {t('answered on {day}', { day: t.day(v.answeredAt!) })}</span>
                          {v.note ? <span className="mt-1 block whitespace-pre-line">{v.note}</span> : null}
                        </span>
                      ) : (
                        <span className="text-ui text-fg-muted">{t('No answer yet.')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {s.codes.length > 0 ? (
                <ul className="grid gap-3" data-testid="identity-codes">
                  {s.codes.map((code) => (
                    <li key={code.id} className="grid gap-1 border-l-4 border-border-subtle pl-3" data-testid="identity-code" data-confirmed={code.confirmed ? 'yes' : 'no'}>
                      <span className="text-ui [overflow-wrap:anywhere]">
                        {code.channel === 'email' ? t('A code e-mailed to an address at {domain}', { domain: code.target }) : t('A code posted on {page}', { page: code.target })}
                      </span>
                      {code.channel === 'page' && code.publicCode ? (
                        <span className="text-sm">
                          {t('Code to look for:')}{' '}
                          <code className="font-mono" translate="no">
                            {code.publicCode}
                          </code>
                        </span>
                      ) : null}
                      <span className="text-sm text-fg-muted">
                        {code.confirmed ? t('Confirmed') : t('Not confirmed yet · valid until {day}', { day: t.day(code.expiresAt) })}
                      </span>
                      {code.channel === 'page' && !code.confirmed && identity.can.checkCode ? (
                        <div className="max-w-[34rem]">
                          <CheckCodeForm caseId={caseId} codeId={code.id} label={t('I saw the code on the page')} initial={codeResults.get(code.id) ?? null} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="max-w-[60ch] text-sm text-fg-muted">
        {t('Enough vouching is one verified teacher, or two verified members who share no teacher. A video is deleted 30 days after the decision. We never ask for identity documents.')}
      </p>
    </section>
  );
}
