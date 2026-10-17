'use client';

// Theme menu: System (follow prefers-color-scheme), Light or Dark. The choice is stored in a
// cookie that the inline head script reads before the first paint (src/design/theme.ts).

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon, SystemThemeIcon } from '@/components/icons';
import { MenuContent, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger, MenuGroupLabel, MenuGroup } from '@/components/ui/menu';
import { applyThemeChoice, parseThemeCookie, type ThemeChoice } from '@/design/theme';
import { cn } from '@/lib/utils';

const EVENT = 'wcr-theme-change';

function subscribe(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  window.addEventListener(EVENT, onChange);
  media.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    media.removeEventListener('change', onChange);
  };
}

const readChoice = (): ThemeChoice => parseThemeCookie(document.cookie) ?? 'system';
const serverChoice = (): ThemeChoice => 'system';

const LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = { system: SystemThemeIcon, light: SunIcon, dark: MoonIcon } as const;

export function ThemeMenu({ variant }: { variant: 'icon' | 'row' }) {
  const choice = useSyncExternalStore(subscribe, readChoice, serverChoice);
  // React resets <html> attributes on a development remount; re-apply the stored choice.
  useLayoutEffect(() => {
    const stored = parseThemeCookie(document.cookie);
    if (stored && document.documentElement.getAttribute('data-theme') !== stored) {
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  const choose = (value: unknown) => {
    const next = value as ThemeChoice;
    applyThemeChoice(next);
    window.dispatchEvent(new Event(EVENT));
  };
  const Icon = ICON[choice];

  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={variant === 'icon' ? `Theme: ${LABEL[choice]}` : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg data-popup-open:bg-surface-3 data-popup-open:text-fg',
              variant === 'icon' ? 'size-11 justify-center' : '-ml-2.5 gap-2.5 px-2.5 text-[0.8125rem]',
            )}
          />
        }
      >
        <Icon size={variant === 'icon' ? 22 : 18} />
        {variant === 'row' ? <span>Theme: {LABEL[choice]}</span> : null}
      </MenuTrigger>
      <MenuContent align={variant === 'icon' ? 'end' : 'start'} side={variant === 'icon' ? 'bottom' : 'top'}>
        <MenuGroup>
          <MenuGroupLabel>Theme</MenuGroupLabel>
          <MenuRadioGroup value={choice} onValueChange={choose}>
            {(['system', 'light', 'dark'] as const).map((value) => {
              const ItemIcon = ICON[value];
              return (
                <MenuRadioItem key={value} value={value}>
                  <ItemIcon size={18} className="text-fg-muted" />
                  <span>{value === 'system' ? 'Match the system' : LABEL[value]}</span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuContent>
    </MenuRoot>
  );
}
