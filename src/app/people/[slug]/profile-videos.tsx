// "Videos" of a profile (owner decisions 2026-11-18, docs/adr/0050-video-embeds.md): the YouTube or
// Vimeo videos of a public person, as many as their plan includes, in the owner's order. Nothing of
// the provider loads until a visitor asks: each video is a title and a "Play" link (?play=<id>), and
// only then does the server render that one player, from youtube-nocookie.com or player.vimeo.com
// (with dnt=1), sandboxed and without pop-ups. No third-party thumbnail. "Open on YouTube" or
// "Open on Vimeo" opens the video's page in the same tab. Staff with a verified second factor get
// "Remove a video" with a reason, which is kept in the audit log and sent to the owner. A Server
// Component: no JavaScript for anyone.

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE, messageId, summaryId } from '@/lib/form-state';
import { PROFILE_VIDEO_REMOVE_FORM } from './form-ids';
import { removeProfileVideoAction } from './video-actions';

export interface PublicProfileVideo {
  id: string;
  title: string;
  provider: 'youtube' | 'vimeo';
  videoId: string;
}

const PROVIDER = { youtube: 'YouTube', vimeo: 'Vimeo' } as const;

const fieldClass = cx(
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg',
  'hover:border-fg-muted focus-visible:border-fg aria-invalid:border-danger',
);

function playerUrl(v: PublicProfileVideo): string {
  return v.provider === 'youtube' ? `https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&rel=0` : `https://player.vimeo.com/video/${v.videoId}?dnt=1&autoplay=1`;
}

function pageUrl(v: PublicProfileVideo): string {
  return v.provider === 'youtube' ? `https://www.youtube.com/watch?v=${v.videoId}` : `https://vimeo.com/${v.videoId}`;
}

export function ProfileVideos({
  slug,
  videos,
  playing,
  staff,
  removed,
  initial,
}: {
  slug: string;
  videos: readonly PublicProfileVideo[];
  /** The id of the video a visitor asked to play, if it is one of these. */
  playing: string | null;
  staff: boolean;
  removed: boolean;
  initial: FormState | null;
}) {
  if (videos.length === 0 && !removed) return null;
  const here = `/people/${slug}`;
  return (
    <section aria-labelledby="videos-heading" className="grid gap-3 border-t border-border-subtle pt-6" data-testid="profile-videos">
      <h2 id="videos-heading" className="font-display text-2xl">
        Videos
      </h2>
      {removed && staff ? (
        <p role="status" className="text-sm font-semibold" data-testid="profile-video-removed">
          The video was removed. Its owner was told why.
        </p>
      ) : null}
      {videos.length > 0 ? (
        <>
          <p className="max-w-[60ch] text-sm text-fg-muted">A video loads from {videos.some((v) => v.provider === 'vimeo') ? 'YouTube or Vimeo' : 'YouTube'} only when you press Play.</p>
          <ul className="grid gap-4">
            {videos.map((v) => {
              const open = playing === v.id;
              return (
                <li key={v.id} id={`video-${v.id}`} className="grid gap-2" data-testid="profile-video">
                  <p className="font-display text-lg [overflow-wrap:anywhere]">{v.title}</p>
                  {open ? (
                    <div className="aspect-video w-full overflow-hidden rounded-sm border border-border-subtle bg-surface-2">
                      <iframe
                        src={playerUrl(v)}
                        title={`${v.title} (${PROVIDER[v.provider]} video)`}
                        className="size-full"
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                        sandbox="allow-scripts allow-same-origin allow-presentation"
                        data-testid="profile-video-player"
                      />
                    </div>
                  ) : null}
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui">
                    {open ? (
                      <a href={`${here}#video-${v.id}`} className={buttonVariants({ variant: 'secondary' })} data-testid="profile-video-close">
                        Close the player<span className="sr-only">: {v.title}</span>
                      </a>
                    ) : (
                      <a href={`${here}?play=${v.id}#video-${v.id}`} className={buttonVariants({ variant: 'secondary' })} data-testid="profile-video-play">
                        Play<span className="sr-only">: {v.title}</span>
                      </a>
                    )}
                    <a href={pageUrl(v)} rel="nofollow ugc noopener noreferrer" className="link inline-flex min-h-11 items-center" data-testid="profile-video-page">
                      Open on {PROVIDER[v.provider]}
                      <span className="sr-only">: {v.title}</span>
                    </a>
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {staff && videos.length > 0 ? (
        <section aria-labelledby="videos-moderation" className="grid gap-3 rounded-sm border border-border-strong p-4" data-testid="profile-videos-moderation">
          <h3 id="videos-moderation" className="font-display text-lg">
            Moderation
          </h3>
          <RemoveVideoForm slug={slug} videos={videos} initial={initial} />
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

function RemoveVideoForm({ slug, videos, initial }: { slug: string; videos: readonly PublicProfileVideo[]; initial: FormState | null }) {
  const state = initial ?? IDLE;
  const form = PROFILE_VIDEO_REMOVE_FORM;
  const failed = state.status === 'error';
  const videoError = failed ? state.fields?.id : undefined;
  const reasonError = failed ? state.fields?.reason : undefined;
  const videoId = fieldId(form, 'id');
  const reasonId = fieldId(form, 'reason');
  return (
    <form id={form} action={removeProfileVideoAction.bind(null, IDLE)} noValidate className="grid gap-3" data-testid="profile-video-remove-form">
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
        <label htmlFor={videoId} className="text-sm font-semibold">
          Video
        </label>
        <select
          id={videoId}
          name="id"
          autoComplete="off"
          defaultValue={state.values?.id ?? videos[0]?.id ?? ''}
          aria-invalid={videoError ? true : undefined}
          aria-describedby={videoError ? `${videoId}-error` : undefined}
          className={fieldClass}
        >
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title} ({PROVIDER[v.provider]})
            </option>
          ))}
        </select>
        <Problem id={`${videoId}-error`} text={videoError} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={reasonId} className="text-sm font-semibold">
          Reason
        </label>
        <p id={`${reasonId}-hint`} className="text-sm text-fg-muted">
          Kept in the audit log and sent to the profile’s owner. The video link is deleted.
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
        <button type="submit" className={cx(buttonVariants({ variant: 'danger', size: 'lg' }), 'w-full sm:w-auto sm:min-w-48')} data-testid="profile-video-remove-submit">
          Remove the video
        </button>
      </div>
    </form>
  );
}
