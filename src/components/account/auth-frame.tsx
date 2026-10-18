// The frame of the account pages (milestone M02, Ink Register): the form in a reading column with
// the page's heading and, on the pages where it helps (sign-up, onboarding, security), a short
// register of what the step means beside it from 1024 px, its label level with the page's eyebrow,
// as the line on the home page sits level with the headline (on phones it follows the form). Each
// note is numbered with a small neutral stamp, never red (red is the brand and the primary action).
//
// A form whose outcome replaces it ("Check your inbox", "This link no longer works") renders its
// own FrameHeader, so the page's one heading always says what the page shows now; AuthFrame then
// gets no title. No hooks here: client forms import FrameHeader too.

import type { ReactNode } from 'react';

import { Seal } from '@/components/ink/seal';

export interface FrameNote {
  title: string;
  text: ReactNode;
}

export interface FrameHeading {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
}

/**
 * The eyebrow, the page's h1 and the lede. `id` and `focus` make the heading the place focus moves
 * to when a form's outcome replaces the form (useFocusOnError; autofocus without JavaScript).
 */
export function FrameHeader({ eyebrow, title, lede, id, focus }: FrameHeading & { id?: string; focus?: boolean }) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h1 id={id} tabIndex={focus ? -1 : undefined} autoFocus={focus} className="mt-2 font-display text-feature outline-offset-4 [overflow-wrap:anywhere]">
        {title}
      </h1>
      {lede ? <div className="mt-3 max-w-[52ch] text-base text-fg-muted">{lede}</div> : null}
    </>
  );
}

/** The space between the heading and the form, for a form that renders its own FrameHeader. */
export function FrameBody({ children }: { children: ReactNode }) {
  return <div className="mt-8">{children}</div>;
}

function NoteStamp({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 -rotate-3 place-items-center rounded-[3px] border-[1.5px] border-border-strong font-display text-base leading-none text-fg-muted"
    >
      {n}
    </span>
  );
}

export function AuthFrame({
  eyebrow,
  title,
  lede,
  notes,
  notesLabel = 'About this step',
  children,
}: {
  /** Without a title the child renders its own FrameHeader. */
  eyebrow?: string;
  title?: ReactNode;
  lede?: ReactNode;
  notes?: readonly FrameNote[];
  notesLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:gap-x-24">
        <div className="min-w-0">
          {title !== undefined && eyebrow !== undefined ? (
            <>
              <FrameHeader eyebrow={eyebrow} title={title} lede={lede} />
              <FrameBody>{children}</FrameBody>
            </>
          ) : (
            children
          )}
        </div>
        {notes && notes.length > 0 ? (
          <aside aria-label={notesLabel} className="min-w-0 lg:border-l lg:border-border-subtle lg:pl-10 xl:pl-14">
            <p className="eyebrow mb-1">{notesLabel}</p>
            <ol className="max-w-[46ch]">
              {notes.map((note, i) => (
                <li key={note.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 border-t border-border-subtle py-4.5 first:border-t-0 lg:first:border-t">
                  <NoteStamp n={i + 1} />
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

/**
 * What just happened, above the content (a confirmed address, a verified session, two-factor
 * authentication on): words and the register's chop, stamped in the neutral dimmed tone (never
 * red, which is the brand and the primary action).
 */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mb-6 flex items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm [--seal-ground:var(--surface-2)]">
      <Seal kind="check" tone="dim" size={24} className="-mt-0.5" />
      <span>{children}</span>
    </p>
  );
}
