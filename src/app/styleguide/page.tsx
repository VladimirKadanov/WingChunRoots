// The style guide (M00b): the tokens of src/design/tokens.ts and the components, in both
// themes side by side. Not indexed. All names are fictional demo content (DEFAULT D20).

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { contrastRatio, formatOklch } from '@/design/color';
import { COLOR_ROLES, THEMES, colors, linkStyles, motion, radius, typeScale, type ThemeName } from '@/design/tokens';
import { BrandMark } from '@/components/brand/brand-mark';
import { Legend } from '@/components/ink/legend';
import { LinkStroke, type LinkKind } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { PersonName } from '@/components/home/names';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import { OverlayDemos, TabsDemo } from './demos';

export const metadata: Metadata = {
  title: 'Style guide',
  description: 'Design tokens and components of WingChunRoots in both themes.',
  robots: { index: false, follow: false },
};

const KINDS: LinkKind[] = ['verified', 'under_review', 'unconfirmed', 'arbitration', 'cross_lineage', 'historical'];
// Literal class names, so Tailwind sees every type step.
const TYPE_CLASS: Record<string, string> = {
  caption: 'text-caption',
  label: 'text-label',
  sm: 'text-sm',
  base: 'text-base',
  md: 'text-md',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  section: 'text-section',
  feature: 'text-feature',
  hero: 'text-hero',
};
const THEME_LABEL: Record<ThemeName, string> = { dark: 'Dark · night paper', light: 'Light · paper' };

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border-subtle py-10 md:py-12">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="mt-2 mb-6 font-display text-2xl md:text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Specimens() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary">Send request</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="ink">Ink</Button>
        <Button variant="danger">Withdraw</Button>
        <Button size="sm">Small</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <label className="text-sm font-semibold">
          Name in the original script
          <Input className="mt-1.5" placeholder="e.g. 馮霖舟 or Мира Пробнова" aria-describedby="sg-original-hint" />
        </label>
        <p id="sg-original-hint" className="text-sm text-fg-muted">
          Optional. Shown next to the Latin-script name.
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <label className="text-sm font-semibold">
          Year you began training
          <Input
            className="mt-1.5"
            defaultValue="20019"
            aria-invalid="true"
            aria-errormessage="sg-year-error"
            aria-describedby="sg-year-error"
            inputMode="numeric"
          />
        </label>
        <p id="sg-year-error" className="text-sm text-danger">
          <span aria-hidden="true">✕ </span>Enter a year between 1850 and this year.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {KINDS.map((kind) => (
          <StatusBadge key={kind} state={kind} />
        ))}
      </div>
      <div className="flex flex-col gap-2" role="status">
        <span className="sr-only">Loading a profile</span>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <p className="text-sm">
        Ground text, <span className="text-fg-muted">muted text</span>, <span className="text-fg-subtle">subtle text</span>,{' '}
        <span className="text-brand-fg">seal red text</span>, <span className="text-danger">an error</span>.
      </p>
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11">
      <header className="pb-8">
        <p className="eyebrow">Design system · Ink Register</p>
        <h1 className="mt-2 font-display text-feature">Style guide</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          The tokens of <code className="font-mono text-[0.9em]">src/design/tokens.ts</code> and the components built on them. Status
          is never colour alone: every state is a stroke, a seal and a word. Red belongs to the brand mark and the primary action.
        </p>
        <div className="mt-5">
          <BrandMark size="lg" />
        </div>
      </header>

      <Section id="sg-themes" eyebrow="Both themes" title="Components side by side">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          {THEMES.map((theme) => (
            <div key={theme} className={cn(`theme-${theme}`, 'rounded-md border border-border-subtle bg-bg p-4 text-fg md:p-6')}>
              <p className="eyebrow mb-4">{THEME_LABEL[theme]}</p>
              <Specimens />
            </div>
          ))}
        </div>
      </Section>

      <Section id="sg-overlays" eyebrow="Interaction" title="Dialog, sheet, menu, toast, tabs">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
          <OverlayDemos />
          <TabsDemo />
        </div>
      </Section>

      <Section id="sg-links" eyebrow="Verification" title="Link states">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Legend layout="list" descriptions />
          <div className="grid content-start gap-3">
            {KINDS.map((kind) => (
              <div key={kind} className="flex items-center gap-3 border-b border-border-subtle pb-3">
                <LinkStroke kind={kind} width={96} />
                <Seal kind={linkStyles[kind].seal} size={24} />
                <span className="text-sm">
                  <b className="font-semibold">{linkStyles[kind].label}</b>
                  <span className="block text-fg-subtle">
                    {linkStyles[kind].stroke} stroke, {linkStyles[kind].width} px
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="sg-colour" eyebrow="Tokens" title="Colour">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
          {THEMES.map((theme) => (
            <table key={theme} className="w-full table-fixed border-collapse text-left text-sm [overflow-wrap:anywhere]">
              <caption className="mb-2 text-left font-semibold">{THEME_LABEL[theme]}: contrast against the page ground</caption>
              <thead>
                <tr className="border-b border-border-strong text-fg-subtle">
                  <th scope="col" className="py-2 pr-2 font-semibold">
                    Role
                  </th>
                  <th scope="col" className="py-2 pr-2 font-semibold">
                    Value
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    vs bg
                  </th>
                </tr>
              </thead>
              <tbody>
                {COLOR_ROLES.map((role) => {
                  const hex = colors[theme][role];
                  return (
                    <tr key={role} className="border-b border-border-subtle">
                      <th scope="row" className="py-1.5 pr-2 font-normal">
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="inline-block size-5 shrink-0 rounded-xs border border-border-strong"
                            style={{ background: hex }}
                          />
                          <code className="font-mono">--{role}</code>
                        </span>
                      </th>
                      <td className="py-1.5 pr-2">
                        <code className="font-mono">{hex}</code>
                        <span className="block font-mono text-caption font-normal tracking-normal text-fg-subtle">{formatOklch(hex)}</span>
                      </td>
                      <td className="py-1.5 text-right tabular">{contrastRatio(hex, colors[theme].bg).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
      </Section>

      <Section id="sg-type" eyebrow="Tokens" title="Type">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {Object.entries(typeScale)
            .reverse()
            .map(([name, step]) => {
              const display = ['hero', 'feature', 'section', '2xl', 'xl', 'lg'].includes(name);
              return (
                <div key={name} className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-border-subtle pb-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
                  <p className="text-xs text-fg-subtle">
                    <code className="font-mono">text-{name}</code>
                    <span className="block">
                      {step.size} / {step.lineHeight}
                      {display ? ' · Gloock' : ' · Schibsted Grotesk'}
                    </span>
                  </p>
                  <p className={cn(display ? 'font-display' : 'font-sans', TYPE_CLASS[name], name === 'caption' && 'uppercase')}>
                    {name === 'caption' ? '8 generations · 6 verified' : <PersonName name="Fung Lam-chau" original={{ text: '馮霖舟', lang: 'zh-Hant' }} />}
                  </p>
                </div>
              );
            })}
          <p className="font-display text-xl">
            <PersonName name="Mira Probnova" original={{ text: 'Мира Пробнова', lang: 'bg' }} /> · 1868 1916 2019
          </p>
          <p className="text-sm text-fg-muted">
            Cyrillic display text uses Noto Serif Display, downloaded only when a page shows Cyrillic. Chinese names use the
            system&apos;s CJK fonts (Traditional unless <code className="font-mono">lang=&quot;zh-Hans&quot;</code>):{' '}
            <span lang="zh-Hans" translate="no" className="cjk font-sans">冯霖舟</span>. Generations are Arabic numerals.
          </p>
        </div>
      </Section>

      <Section id="sg-shape" eyebrow="Tokens" title="Shape and motion">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
          <ul className="flex flex-wrap gap-4">
            {Object.entries(radius).map(([name, value]) => (
              <li key={name} className="grid justify-items-center gap-1.5 text-xs text-fg-subtle">
                <span className="block size-14 border border-border-strong bg-surface-2" style={{ borderRadius: value }} />
                <code className="font-mono">{name}</code>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(motion.duration).map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="font-mono text-fg-subtle">--duration-{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-fg-muted">
            Nothing moves on its own; under prefers-reduced-motion every duration is 0 ms.
          </p>
        </div>
      </Section>
    </div>
  );
}
