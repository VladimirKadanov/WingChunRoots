// Empty and error states of the lineage screens (plan §5.6; milestone M04). The empty state says
// what is missing in words, not with a blank space. The error states never show the error itself;
// they keep the section's own heading, so the outline of the page does not change when a read
// fails, and their Retry is a link that loads the page again, which works without JavaScript.

import { AlertIcon } from '@/components/icons';
import { LinkStroke } from '@/components/ink/link-stroke';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';

/** "No teachers on the record yet": a dotted stroke and a sentence. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 text-ui text-fg-muted">
      <LinkStroke kind="unconfirmed" width={34} className="mt-1.5" />
      <p className="max-w-[56ch]">{children}</p>
    </div>
  );
}

/** The words of a failed section, shared by the server state and the catchError fallback. */
export const sectionErrorText = {
  title: (what: string) => `Couldn't load the ${what}.`,
  body: 'The rest of the page still works. This is usually brief: try again in a moment.',
};

/**
 * A section of a person's page with its heading. `count` follows the title ("Teachers · 2");
 * `focusable` lets a script move focus to the heading (after Retry), outside the tab order.
 */
export function Section({
  id,
  title,
  count,
  focusable = false,
  children,
  className,
}: {
  id: string;
  title: string;
  count?: React.ReactNode;
  focusable?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cx('grid scroll-mt-24 content-start gap-4 border-t border-border-subtle pt-6', className)}>
      <h2 id={id} tabIndex={focusable ? -1 : undefined} className="font-display text-2xl outline-none">
        {title}
        {count !== undefined ? (
          <span className="text-fg-subtle tabular">
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {count}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

/** The frame of an error state: a danger rule, an alert icon and a title, never colour alone. */
export function ErrorPanel({
  title,
  children,
  className,
  ref,
  ...props
}: { title: string; children: React.ReactNode; className?: string; ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cx('grid justify-items-start gap-3 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-4 outline-none', className)}
      {...props}
    >
      <p className="flex items-start gap-2 text-ui font-semibold">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-danger" />
        <span>{title}</span>
      </p>
      {children}
    </div>
  );
}

/**
 * A section whose read failed, rendered on the server (the list view, and the profile without
 * JavaScript): Retry is a link that loads the page again.
 */
export function SectionError({ what, retryHref }: { what: string; retryHref: string }) {
  return (
    <ErrorPanel title={sectionErrorText.title(what)}>
      <p className="max-w-[56ch] text-sm text-fg-muted">{sectionErrorText.body}</p>
      <a href={retryHref} className={buttonVariants({ variant: 'secondary' })}>
        Retry
      </a>
    </ErrorPanel>
  );
}

/** The headings of a group of sections whose shared read failed, with the error under the first. */
export function FailedSections({ headings, children }: { headings: readonly { id: string; title: string }[]; children: React.ReactNode }) {
  if (headings.length === 0) return <>{children}</>;
  return (
    <div className="grid gap-10">
      {headings.map((heading, i) => (
        <Section key={heading.id} id={heading.id} title={heading.title} focusable={i === 0}>
          {i === 0 ? children : <p className="text-sm text-fg-muted">Not loaded: see the message under {headings[0]!.title}.</p>}
        </Section>
      ))}
    </div>
  );
}

/**
 * A person's page whose profile read failed (people.get): the page's own heading and a Retry link
 * that loads it again, inside the app shell, so the reader keeps the navigation.
 */
export function ProfileError({ retryHref }: { retryHref: string }) {
  return (
    <div className="mx-auto grid max-w-content content-start gap-5 px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <p className="eyebrow">Person on the record</p>
      <h1 className="max-w-[20ch] font-display text-section">This profile could not be loaded</h1>
      <ErrorPanel title="The archive did not answer this time." className="max-w-[40rem]">
        <p className="max-w-[56ch] text-sm text-fg-muted">This is usually brief: try again in a moment.</p>
        <a href={retryHref} className={buttonVariants({ variant: 'secondary' })}>
          Retry
        </a>
      </ErrorPanel>
    </div>
  );
}
