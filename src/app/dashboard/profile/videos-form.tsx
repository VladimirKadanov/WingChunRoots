// "Videos on your profile" of /dashboard/profile (owner decisions 2026-11-18, docs/adr/0050-video-embeds.md):
// links to the member's YouTube or Vimeo videos, each with a title, in the order shown, up to the
// plan's quota (Premium Student 2, Professional Sifu 20). Nothing is uploaded. A Server Component
// posting to a thin Server Action over profile.setVideos; the outcome comes back through the page
// (keepFormResult). An empty row is left out. On a plan without videos the saved ones are listed,
// kept and not shown, and there is no form. Every target is at least 44 px.

import { fieldClassName } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE, messageId } from '@/lib/form-state';
import { saveProfileVideosAction } from './actions';
import { PROFILE_VIDEOS_FORM } from './form-ids';

export interface ProfileVideoRow {
  title: string;
  url: string;
}

export function VideosForm({ videos, limit, initial }: { videos: readonly ProfileVideoRow[]; limit: number; initial: FormState | null }) {
  const form = PROFILE_VIDEOS_FORM;
  const state = initial ?? IDLE;
  if (limit === 0) {
    if (videos.length === 0) return null;
    return (
      <section aria-labelledby={`${form}-heading`} className="grid gap-3" data-testid="profile-videos-kept">
        <h2 id={`${form}-heading`} className="font-display text-section">
          Videos on your profile
        </h2>
        <p className="max-w-[60ch] text-ui text-fg-muted">
          Your videos are kept, but your profile does not show them on your current plan. They show again with Premium Student or Professional Sifu.
        </p>
        <ul className="grid gap-1 text-ui">
          {videos.map((video, i) => (
            <li key={i}>
              {video.title}: <span className="break-all text-fg-muted">{video.url}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const count = Math.max(limit, videos.length);
  const rows = Array.from({ length: count }, (_, i) => ({
    title: state.values?.[`videos.${i}.title`] ?? videos[i]?.title ?? '',
    url: state.values?.[`videos.${i}.url`] ?? videos[i]?.url ?? '',
  }));
  const fields = state.status === 'error' ? (state.fields ?? {}) : {};
  const formError = state.status === 'error' ? (fields.videos ?? (Object.keys(fields).length === 0 ? state.message : null)) : null;
  return (
    <section aria-labelledby={`${form}-heading`} className="grid gap-3">
      <h2 id={`${form}-heading`} className="font-display text-section">
        Videos on your profile
      </h2>
      <p className="max-w-[60ch] text-ui text-fg-muted">
        Up to {limit} {limit === 1 ? 'video' : 'videos'} from YouTube or Vimeo, shown on your profile in this order. Paste the video’s address; nothing is uploaded, and a
        video plays only when a visitor asks for it. Leave a row empty to remove it.
        {videos.length > limit ? ` Your profile shows the first ${limit}.` : ''}
      </p>
      <form id={form} action={saveProfileVideosAction.bind(null, IDLE)} noValidate className="grid gap-4" data-testid="profile-videos-form">
        {state.status === 'error' ? (
          <p id={messageId(form)} role="alert" tabIndex={-1} className="text-ui text-danger" data-testid="profile-videos-error">
            <span className="font-semibold">Not saved:</span> {formError ?? 'Check the highlighted fields.'}
          </p>
        ) : state.status === 'done' && state.message ? (
          <p id={messageId(form)} role="status" tabIndex={-1} className="text-ui font-semibold" data-testid="profile-videos-notice">
            {state.message}
          </p>
        ) : null}
        <ol className="grid gap-4">
          {rows.map((row, i) => {
            const titleError = fields[`videos.${i}.title`];
            const urlError = fields[`videos.${i}.url`];
            return (
              <li key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3" data-testid="profile-video-row">
                <div className="grid gap-1.5">
                  <label htmlFor={`${form}-${i}-title`} className="text-sm font-semibold">
                    Video {i + 1} title
                  </label>
                  <input
                    id={`${form}-${i}-title`}
                    name={`videos.${i}.title`}
                    type="text"
                    defaultValue={row.title}
                    maxLength={100}
                    autoComplete="off"
                    aria-invalid={titleError ? true : undefined}
                    aria-describedby={titleError ? `${form}-${i}-title-error` : undefined}
                    className={fieldClassName}
                  />
                  {titleError ? (
                    <p id={`${form}-${i}-title-error`} className="text-sm text-danger">
                      {titleError}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={`${form}-${i}-url`} className="text-sm font-semibold">
                    Video {i + 1} address
                  </label>
                  <input
                    id={`${form}-${i}-url`}
                    name={`videos.${i}.url`}
                    type="url"
                    inputMode="url"
                    defaultValue={row.url}
                    maxLength={1000}
                    autoComplete="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    aria-invalid={urlError ? true : undefined}
                    aria-describedby={urlError ? `${form}-${i}-url-error` : undefined}
                    className={fieldClassName}
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
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })} data-testid="profile-videos-save">
            Save videos
          </button>
        </div>
      </form>
    </section>
  );
}
