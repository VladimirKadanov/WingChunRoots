// The frame of the account pages (milestone M02, Ink Register): the form in a reading column with
// the page's heading, and, from 1024 px, a short register of what the page means beside it (on
// phones it follows the form). Server component; the forms inside it are the only client parts.

import type { ReactNode } from 'react';

export interface FrameNote {
  title: string;
  text: ReactNode;
}

export function AuthFrame({
  eyebrow,
  title,
  lede,
  notes,
  notesLabel = 'About this step',
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  notes?: readonly FrameNote[];
  notesLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:gap-x-24">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-2 font-display text-feature">{title}</h1>
          {lede ? <div className="mt-3 max-w-[52ch] text-base text-fg-muted">{lede}</div> : null}
          <div className="mt-8">{children}</div>
        </div>
        {notes && notes.length > 0 ? (
          <aside aria-label={notesLabel} className="min-w-0 lg:border-l lg:border-border-subtle lg:pt-14 lg:pl-10 xl:pl-14">
            <p className="eyebrow mb-1">{notesLabel}</p>
            <ol className="max-w-[46ch]">
              {notes.map((note, i) => (
                <li key={note.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-t border-border-subtle py-4.5 first:border-t-0 lg:first:border-t">
                  <span aria-hidden="true" className="font-display text-xl leading-none text-fg-subtle">
                    {i + 1}
                  </span>
                  <div className="grid gap-1">
                    <h2 className="font-display text-lg">{note.title}</h2>
                    <div className="text-sm text-fg-muted">{note.text}</div>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** A secondary line under a form: "Already have an account? Sign in". */
export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="mt-8 grid gap-1 border-t border-border-subtle pt-5 text-ui text-fg-muted">{children}</div>;
}
