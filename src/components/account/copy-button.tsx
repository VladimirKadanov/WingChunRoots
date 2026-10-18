'use client';

// Copies a text to the clipboard (milestone M02 fix round 1: the TOTP key and the backup codes).
// It needs JavaScript and the Clipboard API, so it appears only after hydration and where the
// browser has one; the text stays selectable on the page either way. "Copied" is said in words.

import { useState } from 'react';

import { CheckIcon, CopyIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { useHydrated } from './fields';

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);
  if (!hydrated || typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          setCopied(false);
        }
      }}
      className={cx(buttonVariants({ variant: 'secondary' }), className)}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}
