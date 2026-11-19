// "Links on your profile" of /dashboard/profile (owner decision 2026-11-18, docs/adr/0047-featured-profile.md):
// up to five links, each a name and an https address, in the order shown, on a plan with the
// featured profile (Premium Student, Professional Sifu). A Server Component posting to a thin
// Server Action over profile.setLinks; the outcome comes back through the page (keepFormResult).
// An empty row is left out; clearing every row removes them all. On a lower plan the saved links
// are listed, kept and not shown on the profile, and there is no form. Every target is at least 44 px.

import { fieldClassName } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE, messageId } from '@/lib/form-state';
import { saveProfileLinksAction } from './actions';
import { PROFILE_LINKS_FORM } from './form-ids';

export interface ProfileLinkRow {
  label: string;
  url: string;
}

export function LinksForm({ links, allowed, limit, initial }: { links: readonly ProfileLinkRow[]; allowed: boolean; limit: number; initial: FormState | null }) {
  const form = PROFILE_LINKS_FORM;
  const state = initial ?? IDLE;
  if (!allowed) {
    if (links.length === 0) return null;
    return (
      <section aria-labelledby={`${form}-heading`} className="grid gap-3" data-testid="profile-links-kept">
        <h2 id={`${form}-heading`} className="font-display text-section">
          Links on your profile
        </h2>
        <p className="max-w-[60ch] text-ui text-fg-muted">
          Your links are kept, but your profile does not show them on your current plan. They show again with Premium Student or Professional Sifu.
        </p>
        <ul className="grid gap-1 text-ui">
          {links.map((link, i) => (
            <li key={i}>
              {link.label}: <span className="break-all text-fg-muted">{link.url}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const rows = Array.from({ length: limit }, (_, i) => ({
    label: state.values?.[`links.${i}.label`] ?? links[i]?.label ?? '',
    url: state.values?.[`links.${i}.url`] ?? links[i]?.url ?? '',
  }));
  const fields = state.status === 'error' ? (state.fields ?? {}) : {};
  const formError = state.status === 'error' && Object.keys(fields).length === 0 ? state.message : null;
  return (
    <section aria-labelledby={`${form}-heading`} className="grid gap-3">
      <h2 id={`${form}-heading`} className="font-display text-section">
        Links on your profile
      </h2>
      <p id={`${form}-hint`} className="max-w-[60ch] text-ui text-fg-muted">
        Up to {limit} links, such as your school’s website or your own page, shown on your profile in this order. Each needs a name and a full address that starts
        with https://. Leave a row empty to remove it.
      </p>
      <form id={form} action={saveProfileLinksAction.bind(null, IDLE)} noValidate className="grid gap-4" data-testid="profile-links-form">
        {state.status === 'error' ? (
          <p id={messageId(form)} role="alert" tabIndex={-1} className="text-ui text-danger" data-testid="profile-links-error">
            <span className="font-semibold">Not saved:</span> {formError ?? 'Check the highlighted fields.'}
          </p>
        ) : state.status === 'done' && state.message ? (
          <p id={messageId(form)} role="status" tabIndex={-1} className="text-ui font-semibold" data-testid="profile-links-notice">
            {state.message}
          </p>
        ) : null}
        <ol className="grid gap-4">
          {rows.map((row, i) => {
            const labelError = fields[`links.${i}.label`];
            const urlError = fields[`links.${i}.url`];
            return (
              <li key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3" data-testid="profile-link-row">
                <div className="grid gap-1.5">
                  <label htmlFor={`${form}-${i}-label`} className="text-sm font-semibold">
                    Link {i + 1} name
                  </label>
                  <input
                    id={`${form}-${i}-label`}
                    name={`links.${i}.label`}
                    type="text"
                    defaultValue={row.label}
                    maxLength={120}
                    autoComplete="off"
                    aria-invalid={labelError ? true : undefined}
                    aria-describedby={labelError ? `${form}-${i}-label-error` : undefined}
                    className={fieldClassName}
                    data-testid="profile-link-label"
                  />
                  {labelError ? (
                    <p id={`${form}-${i}-label-error`} className="text-sm text-danger">
                      {labelError}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={`${form}-${i}-url`} className="text-sm font-semibold">
                    Link {i + 1} address
                  </label>
                  <input
                    id={`${form}-${i}-url`}
                    name={`links.${i}.url`}
                    type="url"
                    inputMode="url"
                    defaultValue={row.url}
                    maxLength={1000}
                    autoComplete="url"
                    placeholder="https://"
                    aria-invalid={urlError ? true : undefined}
                    aria-describedby={urlError ? `${form}-${i}-url-error` : undefined}
                    className={fieldClassName}
                    data-testid="profile-link-url"
                  />
                  {urlError ? (
                    <p id={`${form}-${i}-url-error`} className="text-sm text-danger">
                      {urlError}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <div>
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })} data-testid="profile-links-save">
            Save links
          </button>
        </div>
      </form>
    </section>
  );
}
