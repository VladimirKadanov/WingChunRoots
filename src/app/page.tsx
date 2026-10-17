// Home page, first version (M00b; the final one is M13): the thesis through a living lineage,
// a demo search, how verification works and a featured lineage. All people and halls here are
// fictional demo content (DEFAULT D20).

import Link from 'next/link';
import { ArrowRightIcon, LockIcon } from '@/components/icons';
import { HallTree } from '@/components/home/hall-tree';
import { DEMO_HALL } from '@/components/home/demo-lineage';
import { LivingLine } from '@/components/home/living-line';
import { Legend } from '@/components/ink/legend';
import { LinkStroke } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { buttonVariants } from '@/components/ui/button';
import { linkStyles, type VerificationState } from '@/design/tokens';
import { cn } from '@/lib/utils';

const STEPS: { state: VerificationState; text: string }[] = [
  {
    state: 'unconfirmed',
    text: 'A student names a teacher, or a family account mentions one. The line is drawn in dots until someone confirms it.',
  },
  {
    state: 'under_review',
    text: 'Certificates, photos or letters are submitted privately. An archivist checks them; the line is broken and carries an hourglass seal.',
  },
  {
    state: 'verified',
    text: 'The teacher confirms, or the evidence holds up. The line is drawn in solid ink and stamped with a jade seal.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-content px-[max(1rem,env(safe-area-inset-left,0px))] pt-6 pb-10 md:px-10 md:pt-11 md:pb-14">
      <LivingLine
        intro={
          <>
            <h1 className="font-display text-hero text-fg">
              <span className="eyebrow mb-2 block md:mb-3">WingChunRoots · Lineage record</span>
              Every teacher, every student, on the record
              <Seal kind="check" className="ml-[0.1em] inline-block size-[0.4em] -rotate-4 align-[0.02em]" />
            </h1>
            <p className="mt-4 max-w-[50ch] text-[0.96875rem] leading-[1.55] text-fg-muted md:mt-5 md:text-md">
              WingChunRoots maps who taught whom, from the halls of Foshan to evening classes in Sofia. Every teacher–student
              link carries its own evidence and its own seal.
            </p>
          </>
        }
      />

      <section aria-labelledby="how-heading" className="border-t border-border-subtle py-10 md:py-14">
        <div className="mb-6 grid max-w-[62ch] gap-2.5">
          <p className="eyebrow">Verification</p>
          <h2 id="how-heading" className="font-display text-section">
            How a link earns its seal
          </h2>
          <p className="text-[0.96875rem] text-fg-muted">
            Every teacher–student link is checked on its own. Its state is drawn into the line, stamped with a seal and named in
            words, so it never depends on colour.
          </p>
        </div>
        <ol className="grid md:grid-cols-3 md:gap-x-8">
          {STEPS.map((step, i) => {
            const style = linkStyles[step.state];
            return (
              <li
                key={step.state}
                className="grid grid-cols-[78px_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-border-subtle py-[18px] md:grid-cols-1 md:content-start"
              >
                <div className="row-span-2 flex flex-col items-start gap-2.5 pt-1 md:row-span-1 md:flex-row md:items-center md:gap-3.5">
                  <LinkStroke kind={step.state} />
                  <Seal kind={style.seal} size={26} />
                </div>
                <h3 className="flex items-baseline gap-2.5 font-display text-xl">
                  <span className="font-sans text-caption tracking-[0.14em] text-fg-subtle">{i + 1}</span>
                  {style.label}
                </h3>
                <p className="max-w-[42ch] text-[0.90625rem] text-fg-muted">{step.text}</p>
              </li>
            );
          })}
        </ol>
        <ul className="mt-1.5 grid md:grid-cols-3 md:gap-x-8">
          <li className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-4 border-t border-dashed border-border-strong py-4 md:grid-cols-1 md:gap-2">
            <span className="flex items-center gap-2 pt-0.5">
              <LinkStroke kind="arbitration" width={44} />
              <Seal kind="scales" size={22} />
            </span>
            <div className="text-[0.90625rem] text-fg-muted">
              <b className="mb-0.5 block font-display text-lg font-normal text-fg">In arbitration</b>
              When a claim is disputed, an independent panel hears both sides. The line splits in two until it decides.
            </div>
          </li>
          <li className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-4 border-t border-dashed border-border-strong py-4 md:grid-cols-1 md:gap-2">
            <span className="flex items-center gap-2 pt-0.5">
              <LinkStroke kind="cross_lineage" width={44} />
              <Seal kind="bridge" size={22} />
            </span>
            <div className="text-[0.90625rem] text-fg-muted">
              <b className="mb-0.5 block font-display text-lg font-normal text-fg">Cross-lineage</b>
              Many people train in more than one hall. Those links are drawn hollow, curve between halls and are labelled.
            </div>
          </li>
          <li className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-4 border-t border-dashed border-border-strong py-4 md:grid-cols-1 md:gap-2">
            <span className="flex items-center gap-2 pt-0.5 text-fg">
              <LockIcon size={22} />
            </span>
            <div className="text-[0.90625rem] text-fg-muted">
              <b className="mb-0.5 block font-display text-lg font-normal text-fg">Pending claims stay private</b>
              A new claim between living people is visible only to the two of them until it is confirmed. It never appears as a
              public fact.
            </div>
          </li>
        </ul>
      </section>

      <section
        aria-labelledby="hall-heading"
        className="grid items-start gap-7 border-t border-border-subtle py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:gap-16 md:py-14"
      >
        <div className="md:sticky md:top-11">
          <p className="eyebrow">Featured lineage · demo</p>
          <h2 id="hall-heading" className="mt-2.5 font-display text-feature">
            <span lang="en" translate="no">
              {DEMO_HALL.name}
            </span>
            <span lang={DEMO_HALL.original.lang} translate="no" className="cjk mt-2.5 block text-[0.56em] tracking-[0.24em] text-fg-muted">
              {DEMO_HALL.original.text}
            </span>
          </h2>
          <p className="mt-2 text-[0.8125rem] tracking-[0.04em] text-fg-subtle">
            <span translate="no">{DEMO_HALL.romanization}</span> · founded {DEMO_HALL.founded}, {DEMO_HALL.origin}
          </p>
          <p className="mt-3.5 max-w-[52ch] text-fg-muted">
            A fictional hall drawn for this preview: eight generations from Foshan to Sofia, a student with two teachers, one
            teacher from another hall and links in every state.
          </p>
          <dl className="mt-5 mb-6 grid grid-cols-3 gap-3 border-t border-border-subtle pt-4">
            <div>
              <dt className="text-[0.6875rem] leading-tight font-semibold tracking-[0.14em] text-fg-subtle uppercase">People</dt>
              <dd className="mt-1.5 font-display text-[2rem] leading-none tabular">{DEMO_HALL.people}</dd>
            </div>
            <div>
              <dt className="text-[0.6875rem] leading-tight font-semibold tracking-[0.14em] text-fg-subtle uppercase">Generations</dt>
              <dd className="mt-1.5 font-display text-[2rem] leading-none tabular">{DEMO_HALL.generations}</dd>
            </div>
            <div>
              <dt className="text-[0.6875rem] leading-tight font-semibold tracking-[0.14em] text-fg-subtle uppercase">
                Verified links
              </dt>
              <dd className="mt-1.5 font-display text-[2rem] leading-none tabular">
                {DEMO_HALL.verifiedLinks}
                <small className="ml-1 font-sans text-[0.75rem] text-fg-subtle">of {DEMO_HALL.links}</small>
              </dd>
            </div>
          </dl>
          {/* The explorer opens in M05; until then the link lands on the "not drawn yet" page. */}
          <Link href="/explore" prefetch={false} className={cn(buttonVariants({ variant: 'primary' }))}>
            Explore the lineage
            <ArrowRightIcon />
          </Link>
        </div>
        <figure className="rounded-md border border-border-subtle bg-surface-1 p-3 md:p-4">
          <HallTree className="block h-auto w-full" />
          <figcaption className="mt-3 border-t border-border-subtle pt-3">
            <Legend />
          </figcaption>
        </figure>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-subtle pt-4 text-[0.8125rem] text-fg-subtle">
        <span>Demo data: fictional people and halls.</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-1">
          <Link href="/styleguide" className="link inline-flex min-h-11 items-center px-1.5">
            Style guide
          </Link>
          <Link href="/legal/licenses" className="link inline-flex min-h-11 items-center px-1.5">
            Licenses
          </Link>
        </nav>
      </footer>
    </div>
  );
}
