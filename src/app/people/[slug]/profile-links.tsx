// "Links" of a featured profile (owner decision 2026-11-18, docs/adr/0047-featured-profile.md): the
// links of a public person whose plan includes them, in the owner's order, each opening the
// address in the same tab and marked as the member's own (rel nofollow ugc), never a referrer.
// Staff with a verified second factor get "Remove a link" with a reason, which is kept in the
// audit log and sent to the owner. A Server Component: no JavaScript for anyone.

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE, messageId, summaryId } from '@/lib/form-state';
import { PROFILE_LINK_REMOVE_FORM } from './form-ids';
import { removeProfileLinkAction } from './link-actions';

export interface PublicProfileLink {
  id: string;
  label: string;
  url: string;
}

const fieldClass = cx(
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg',
  'hover:border-fg-muted focus-visible:border-fg aria-invalid:border-danger',
);

/** The host name shown beside the label, so a reader sees where a link goes before opening it. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function ProfileLinks({
  slug,
  links,
  staff,
  removed,
  initial,
}: {
  slug: string;
  links: readonly PublicProfileLink[];
  staff: boolean;
  removed: boolean;
  initial: FormState | null;
}) {
  if (links.length === 0 && !removed) return null;
  return (
    <section aria-labelledby="links-heading" className="grid gap-3 border-t border-border-subtle pt-6" data-testid="profile-links">
      <h2 id="links-heading" className="font-display text-2xl">
        Links
      </h2>
      {removed && staff ? (
        <p role="status" className="text-sm font-semibold" data-testid="profile-link-removed">
          The link was removed. Its owner was told why.
        </p>
      ) : null}
      {links.length > 0 ? (
        <ul className="grid gap-1">
          {links.map((link) => (
            <li key={link.id}>
              <a href={link.url} rel="nofollow ugc noopener noreferrer" className="link inline-flex min-h-11 flex-wrap items-center gap-x-2" data-testid="profile-link">
                <span>{link.label}</span>
                <span className="text-sm text-fg-muted">{hostOf(link.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {staff && links.length > 0 ? (
        <section aria-labelledby="links-moderation" className="grid gap-3 rounded-sm border border-border-strong p-4" data-testid="profile-links-moderation">
          <h3 id="links-moderation" className="font-display text-lg">
            Moderation
          </h3>
          <RemoveLinkForm slug={slug} links={links} initial={initial} />
        </section>
      ) : null}
    </section>
  );
}

function Problem({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <AlertIcon size={16} className="mt-0.5" />
      <span>{text}</span>
    </p>
  );
}

function RemoveLinkForm({ slug, links, initial }: { slug: string; links: readonly PublicProfileLink[]; initial: FormState | null }) {
  const state = initial ?? IDLE;
  const form = PROFILE_LINK_REMOVE_FORM;
  const failed = state.status === 'error';
  const linkError = failed ? state.fields?.id : undefined;
  const reasonError = failed ? state.fields?.reason : undefined;
  const linkId = fieldId(form, 'id');
  const reasonId = fieldId(form, 'reason');
  return (
    <form id={form} action={removeProfileLinkAction.bind(null, IDLE)} noValidate className="grid gap-3" data-testid="profile-link-remove-form">
      <div id={summaryId(form)} tabIndex={-1} className="outline-none">
        {failed && state.message ? (
          <p id={messageId(form)} role="alert" className="flex items-start gap-1.5 font-semibold text-danger">
            <AlertIcon size={16} className="mt-1" />
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-1.5">
        <label htmlFor={linkId} className="text-sm font-semibold">
          Link
        </label>
        <select
          id={linkId}
          name="id"
          autoComplete="off"
          defaultValue={state.values?.id ?? links[0]?.id ?? ''}
          aria-invalid={linkError ? true : undefined}
          aria-describedby={linkError ? `${linkId}-error` : undefined}
          className={fieldClass}
        >
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.label} ({hostOf(link.url)})
            </option>
          ))}
        </select>
        <Problem id={`${linkId}-error`} text={linkError} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={reasonId} className="text-sm font-semibold">
          Reason
        </label>
        <p id={`${reasonId}-hint`} className="text-sm text-fg-muted">
          Kept in the audit log and sent to the profile’s owner. The link is deleted.
        </p>
        <textarea
          id={reasonId}
          name="reason"
          rows={3}
          maxLength={1000}
          required
          defaultValue={state.values?.reason ?? ''}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${reasonId}-hint ${reasonId}-error` : `${reasonId}-hint`}
          className={cx(fieldClass, 'py-3')}
        />
        <Problem id={`${reasonId}-error`} text={reasonError} />
      </div>
      <div>
        <button type="submit" className={cx(buttonVariants({ variant: 'danger', size: 'lg' }), 'w-full sm:w-auto sm:min-w-48')} data-testid="profile-link-remove-submit">
          Remove the link
        </button>
      </div>
    </form>
  );
}
