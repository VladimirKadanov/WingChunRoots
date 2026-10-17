// Home page, first version (M00b; the final one is M13): the thesis through a living lineage,
// a demo search, how verification works and a featured lineage. All people and halls here are
// fictional demo content (DEFAULT D20).

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandSeal } from '@/components/brand/brand-mark';
import { LockIcon } from '@/components/icons';
import { DEMO_HALL, DEMO_LINE } from '@/components/home/demo-lineage';
import { HALL_TREE_KINDS, HALL_TREE_STATS, HallTree, HallTreeKey } from '@/components/home/hall-tree';
import { LivingLine } from '@/components/home/living-line';
import { TraceLineButton } from '@/components/home/trace-line';
import { Legend } from '@/components/ink/legend';
import { LinkStroke, type LinkKind } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { DEMO_NOTICE } from '@/components/shell/demo-notice';
import { buttonVariants } from '@/components/ui/button';
import { linkStyles, type VerificationState } from '@/design/tokens';

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

const OTHER_MARKS: { kind: LinkKind | 'private'; title: string; text: string }[] = [
  {
    kind: 'arbitration',
    title: 'In arbitration',
    text: 'When a claim is disputed, an independent panel hears both sides. The line splits in two until it decides.',
  },
  {
    kind: 'cross_lineage',
    title: 'Cross-lineage',
    text: 'Many people train in more than one hall. Those links are drawn hollow, curve in from the other hall and are labelled.',
  },
  {
    kind: 'private',
    title: 'Pending claims stay private',
    text: 'A new claim between living people is visible only to the two of them until it is confirmed. It never appears as a public fact.',
  },
];

/** One mark of the verification section: its drawing on the left (phones) or on top. */
function Mark({ art, title, children }: { art: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[78px_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-border-subtle py-4.5 md:grid-cols-1 md:content-start md:gap-y-2">
      <div className="row-span-2 flex flex-col items-start gap-2.5 pt-1 md:row-span-1 md:min-h-8 md:flex-row md:items-center md:gap-3.5">
        {art}
      </div>
      <h3 className="flex items-baseline gap-2.5 font-display text-xl">{title}</h3>
      <p className="max-w-[42ch] text-sm text-fg-muted">{children}</p>
    </li>
  );
}

export default function HomePage() {
  const newest = DEMO_LINE.length - 1;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <LivingLine
        heading={
          <>
            <p className="eyebrow mb-2 md:mb-3">A Wing Chun lineage record · demo</p>
            {/* The brand seal stamps the end of the claim; it names the site for screen readers. */}
            <h1 className="font-display text-hero text-fg">
              Every teacher, every student, on the record
              <BrandSeal
                label="WingChunRoots"
                size={28}
                className="ml-[0.14em] inline-block size-[0.44em] -translate-y-[0.04em] -rotate-4 align-baseline"
              />
            </h1>
          </>
        }
        lede={
          <p className="max-w-[50ch] text-base text-fg-muted md:text-md">
            WingChunRoots maps who taught whom, from the halls of Foshan to evening classes in Sofia. Every teacher–student link
            carries its own evidence and its own seal.
          </p>
        }
      />

      <section aria-labelledby="how-heading" className="border-t border-border-subtle py-section md:py-section-desktop">
        <div className="mb-6 grid max-w-[62ch] gap-2.5">
          <p className="eyebrow">Verification</p>
          <h2 id="how-heading" className="font-display text-section">
            How a link earns its seal
          </h2>
          <p className="text-base text-fg-muted">
            Every teacher–student link is checked on its own. Its state is drawn into the line, stamped with a seal and named in
            words, so it never depends on colour.
          </p>
        </div>

        <p id="how-path" className="eyebrow mb-2">
          The path to a seal
        </p>
        <ol aria-labelledby="how-path" className="grid md:grid-cols-3 md:gap-x-8">
          {STEPS.map((step, i) => {
            const style = linkStyles[step.state];
            return (
              <Mark
                key={step.state}
                art={
                  <>
                    <LinkStroke kind={step.state} />
                    <Seal kind={style.seal} size={26} />
                  </>
                }
                title={
                  <>
                    <span className="text-fg-subtle tabular">{i + 1}</span>
                    {style.label}
                  </>
                }
              >
                {step.text}
              </Mark>
            );
          })}
        </ol>

        <p id="how-other" className="eyebrow mt-8 mb-2">
          Other marks on the line
        </p>
        <ul aria-labelledby="how-other" className="grid md:grid-cols-3 md:gap-x-8">
          {OTHER_MARKS.map((mark) => (
            <Mark
              key={mark.kind}
              art={
                mark.kind === 'private' ? (
                  <LockIcon size={26} className="text-fg" />
                ) : (
                  <>
                    <LinkStroke kind={mark.kind} />
                    <Seal kind={linkStyles[mark.kind].seal} size={26} />
                  </>
                )
              }
              title={mark.title}
            >
              {mark.text}
            </Mark>
          ))}
        </ul>
      </section>

      {/* Side by side only from 1280 px: narrower, the drawing would shrink its labels below 11 px. */}
      <section
        aria-labelledby="hall-heading"
        className="grid items-start gap-7 border-t border-border-subtle py-section md:py-section-desktop xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:gap-16"
      >
        <div className="xl:sticky xl:top-11">
          <p className="eyebrow">Featured lineage · demo</p>
          <h2 id="hall-heading" className="mt-2.5 font-display text-feature">
            <span lang="en" translate="no">
              {DEMO_HALL.name}
            </span>
            <span lang={DEMO_HALL.original.lang} translate="no" className="cjk mt-2.5 block text-[0.56em] tracking-[0.24em] text-fg-muted">
              {DEMO_HALL.original.text}
            </span>
          </h2>
          <p className="mt-2 text-sm tracking-[0.04em] text-fg-subtle">
            <span translate="no">{DEMO_HALL.romanization}</span> · founded {DEMO_HALL.founded}, {DEMO_HALL.origin}
          </p>
          <p className="mt-3.5 max-w-[52ch] text-base text-fg-muted">
            A fictional hall drawn for this preview: eight rows from Foshan to Sofia, a student with two teachers, a teacher from{' '}
            <span translate="no">{DEMO_HALL.otherHall}</span> and links in every state.
          </p>
          <dl className="mt-5 mb-6 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-3 gap-y-4 border-t border-border-subtle pt-4">
            <div className="flex min-w-0 flex-col">
              <dt className="text-caption text-fg-subtle uppercase [overflow-wrap:anywhere]">People</dt>
              <dd className="mt-auto pt-1.5 font-display text-3xl tabular">{HALL_TREE_STATS.people}</dd>
            </div>
            <div className="flex min-w-0 flex-col">
              <dt className="text-caption text-fg-subtle uppercase [overflow-wrap:anywhere]">Verified generations</dt>
              <dd className="mt-auto pt-1.5 font-display text-3xl tabular">{HALL_TREE_STATS.verifiedGenerations}</dd>
            </div>
            <div className="flex min-w-0 flex-col">
              <dt className="text-caption text-fg-subtle uppercase [overflow-wrap:anywhere]">Verified links</dt>
              <dd className="mt-auto pt-1.5 font-display text-3xl tabular">
                {HALL_TREE_STATS.verifiedLinks}
                <small className="ml-1 font-sans text-xs text-fg-subtle">of {HALL_TREE_STATS.links}</small>
              </dd>
            </div>
          </dl>
          {/* The explorer opens in M05 (/explore). Until then the hall's line is traced above. */}
          <TraceLineButton index={newest} className={buttonVariants({ variant: 'primary' })}>
            Trace this hall’s line
          </TraceLineButton>
        </div>
        <figure className="w-full max-w-[26rem] rounded-md border border-border-subtle bg-surface-1 p-2 sm:p-3 md:p-4">
          <HallTree className="block h-auto w-full" />
          <figcaption className="mt-3 grid gap-3 border-t border-border-subtle pt-3">
            <Legend kinds={HALL_TREE_KINDS} />
            <HallTreeKey />
            {/* DEFAULT D22: a row is a generation only along verified links from the founder. */}
            <p className="text-sm text-fg-muted">
              Rows count down from the founder. A row is a generation of the hall only where every link above it is verified;
              the newest student’s link is still under review.
            </p>
          </figcaption>
        </figure>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-subtle pt-4 text-sm text-fg-subtle">
        {/* The desktop rail says it already. */}
        <span className="md:hidden">{DEMO_NOTICE}</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-1 md:ml-auto">
          <Link href="/styleguide" prefetch={false} className="link inline-flex min-h-11 items-center px-1.5">
            Style guide
          </Link>
          <Link href="/legal/licenses" prefetch={false} className="link inline-flex min-h-11 items-center px-1.5">
            Licenses
          </Link>
        </nav>
      </footer>
    </div>
  );
}
