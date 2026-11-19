// "Supporter badge" of /dashboard/profile (owner decision 2026-11-18, docs/adr/0049-supporter-badge.md):
// the member's choice to show the badge on their public profile, off until they switch it on
// (DEFAULT ADR 0049). A Server Component posting to a thin Server Action over profile.setSupporter;
// the outcome comes back through the page (keepFormResult). On a lower plan with the choice off
// there is nothing to show; with it on, a sentence says it is kept and how to switch it off.

import { SupporterBadge } from '@/components/lineage/supporter-badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE, messageId } from '@/lib/form-state';
import { saveSupporterAction } from './actions';
import { PROFILE_SUPPORTER_FORM } from './form-ids';

export function SupporterForm({ show, allowed, publicProfile, initial }: { show: boolean; allowed: boolean; publicProfile: boolean; initial: FormState | null }) {
  const form = PROFILE_SUPPORTER_FORM;
  const state = initial ?? IDLE;
  if (!allowed && !show) return null;
  const checked = state.status === 'error' ? state.values?.show === 'on' : show;
  return (
    <section aria-labelledby={`${form}-heading`} className="grid gap-3" data-testid="profile-supporter">
      <h2 id={`${form}-heading`} className="font-display text-section">
        Supporter badge
      </h2>
      <p className="max-w-[60ch] text-ui text-fg-muted">
        {allowed
          ? 'You can show that you support WingChunRoots with a badge on your profile. It changes nothing else: not search, not the lineage, not any review.'
          : 'Your choice is kept, but your profile does not show the badge on your current plan. It shows again with Premium Student or Professional Sifu.'}
        {allowed && !publicProfile ? ' Your profile is private, so nobody sees it until you show your profile publicly.' : ''}
      </p>
      <p className="text-sm text-fg-muted">
        It looks like this: <SupporterBadge />
      </p>
      <form id={form} action={saveSupporterAction.bind(null, IDLE)} className="grid gap-3" data-testid="profile-supporter-form">
        <label className="flex min-h-11 items-center gap-3 text-ui">
          <input type="checkbox" name="show" defaultChecked={checked} className="size-5 accent-fg" data-testid="profile-supporter-show" />
          Show the Supporter badge on my profile
        </label>
        <div>
          <button type="submit" className={buttonVariants({ variant: 'secondary' })} data-testid="profile-supporter-save">
            Save
          </button>
        </div>
        <div id={`${form}-message`} tabIndex={-1}>
          {state.status === 'error' ? (
            <p id={messageId(form)} role="alert" className="text-ui text-danger" data-testid="profile-supporter-error">
              <span className="font-semibold">Not saved:</span> {state.message}
            </p>
          ) : state.status === 'done' ? (
            <p role="status" className="text-ui font-semibold" data-testid="profile-supporter-notice">
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
