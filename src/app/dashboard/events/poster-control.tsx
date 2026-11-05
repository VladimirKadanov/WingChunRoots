'use client';

// The poster of an event (milestone M17, In scope 5): upload or replace it, or remove it, through
// events.uploadPoster and events.removePoster on the web's /api/rpc (plan §6.8), as a gallery photo
// is (src/components/gallery/rpc.tsx). The server checks the organizer, the type by its magic bytes
// and encodes the image again without EXIF, GPS, XMP or IPTC. The outcome is said in words in one
// polite status line; real buttons and a real file input (44 px targets).

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';

import { callRpc, MAX_BYTES, MAX_MB, messageOf, type Status, StatusLine, uploadRpc } from '@/components/gallery/rpc';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import type { EventPosterDto } from '@/server/dto/events';

/** The types a poster may be (the server checks the magic bytes again). */
const POSTER_ACCEPT = 'image/jpeg,image/png,image/webp';

export function PosterControl({ eventId, title, poster }: { eventId: string; title: string; poster: EventPosterDto | null }) {
  const id = useId();
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const busy = status.kind === 'busy';

  async function run(busyText: string, doneText: string, call: () => Promise<Response>) {
    setStatus({ kind: 'busy', text: busyText });
    try {
      const response = await call();
      if (!response.ok) {
        setStatus({ kind: 'refused', text: await messageOf(response, 'The poster could not be saved. Try again.') });
        return;
      }
      setStatus({ kind: 'done', text: doneText });
      router.refresh();
    } catch {
      setStatus({ kind: 'refused', text: 'The connection failed. Nothing was changed; try again.' });
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'refused', text: `The image is larger than ${MAX_MB} MB.` });
      return;
    }
    void run('Uploading the poster…', 'Poster saved.', () => uploadRpc('/api/rpc/events/poster/upload', { id: eventId }, file)).finally(() => {
      if (picker.current) picker.current.value = '';
    });
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-3" data-testid="poster-control">
      <h2 id={`${id}-heading`} className="font-display text-xl">
        Poster
      </h2>
      <p className="text-sm text-fg-muted">A JPEG, PNG or WebP image of at most {MAX_MB} MB. Its metadata and location are removed; it is apart from your photos.</p>
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster.large} alt={`Poster of ${title}`} width={256} height={256} className="size-64 rounded-sm border border-border-subtle object-cover" data-testid="poster-preview" />
      ) : null}
      <div className="flex flex-wrap gap-3">
        <label className={cx(buttonVariants({ variant: 'secondary' }), 'cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-2')}>
          <input ref={picker} type="file" accept={POSTER_ACCEPT} className="sr-only" disabled={busy} onChange={(e) => onFile(e.currentTarget.files?.[0])} data-testid="poster-file" />
          {poster ? 'Replace the poster' : 'Upload a poster'}
        </label>
        {poster ? (
          <button
            type="button"
            className={buttonVariants({ variant: 'secondary' })}
            disabled={busy}
            onClick={() => void run('Removing the poster…', 'Poster removed.', () => callRpc('/api/rpc/events/poster/remove', { id: eventId }))}
            data-testid="poster-remove"
          >
            Remove the poster
          </button>
        ) : null}
      </div>
      <StatusLine status={status} testId="poster-status" />
    </section>
  );
}
