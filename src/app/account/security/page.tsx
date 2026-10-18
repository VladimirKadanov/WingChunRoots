// /account/security (milestone M02, In scope 2 and 7; fix round 1, findings H3, H4 and H5):
// two-factor authentication with TOTP, as a register of its state and the one step that follows.
//
// - Off: set it up with the password.
// - Setup not finished: the key, rendered here on the server for the browser that started the
//   setup with the password (QR code, the key as text with a Copy button, and on touch screens a
//   link that opens the authenticator app), then the first code. Works without JavaScript and
//   after a reload; another browser, or the same one after 30 minutes, starts again.
// - On, right after the first code or new codes (`?codes=new`): the backup codes to save (Copy
//   all, Download as a text file, a required "I have saved these codes").
// - On: the backup codes left, new codes with the password, and, for members, turning it off.
//   A session that has not passed the second factor verifies it here (`?next=/admin`).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { AuthFrame, Notice } from '@/components/account/auth-frame';
import { CopyButton } from '@/components/account/copy-button';
import { CheckboxField } from '@/components/account/fields';
import { PageRedirect } from '@/components/account/page-redirect';
import { QrCode } from '@/components/account/qr-code';
import { TwoFactorState, type TwoFactorStateKind } from '@/components/account/two-factor-state';
import { DownloadIcon, ExternalAppIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { IDLE } from '@/lib/form-state';
import { cn } from '@/lib/utils';
import { BACKUP_CODE_COUNT } from '@/server/auth/credentials';
import { safeNextPath } from '@/server/auth/guards';
import { qrModules } from '@/server/auth/totp';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { readBackupCodes, readPendingSetup } from '@/server/forms/two-factor';
import { serverClient } from '@/server/rpc/server';
import {
  ConfirmTwoFactorForm,
  DisableTwoFactorForm,
  EnableTwoFactorForm,
  NewBackupCodesForm,
  VerifySessionForm,
} from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Two-factor authentication',
  robots: { index: false },
};

type Note = { title: string; text: string };

/** The register beside the form says what matters in the state the account is in now. */
function notesFor(status: 'off' | 'pending' | 'on', staff: boolean): readonly Note[] {
  if (status === 'off') {
    return [
      {
        title: 'Why a second factor',
        text: 'A password can leak. With two-factor authentication, signing in also needs the code that changes every 30 seconds in your app.',
      },
      {
        title: 'What you need',
        text: 'An authenticator app on your phone: any app for time-based codes (TOTP) works. Setting it up takes about two minutes.',
      },
      {
        title: 'Staff accounts',
        text: 'Moderators, archivists and administrators keep it on, and every staff session passes the second factor before it opens a staff page.',
      },
    ];
  }
  if (status === 'pending') {
    return [
      {
        title: 'Nothing changes yet',
        text: 'Until you enter the first code, signing in needs only your password. You can leave and come back: the same key waits here.',
      },
      {
        title: 'After the first code',
        text: 'You get 10 backup codes to save, and every other session of your account ends, so other devices sign in again with a code.',
      },
    ];
  }
  return [
    {
      title: 'Backup codes',
      text: 'Each code signs you in once instead of the code from your app. Get new ones when few are left; the old ones then stop working.',
    },
    {
      title: 'Lost your phone?',
      text: staff
        ? 'Sign in with a backup code. Staff accounts keep two-factor authentication on, so the backup codes are the way back in: keep them safe.'
        : 'Sign in with a backup code, then turn two-factor authentication off and set it up again on the new phone.',
    },
  ];
}

const NOTICES = {
  verified: 'Session verified. Staff pages open in this session now.',
  off: 'Two-factor authentication turned off. Signing in needs only your password now.',
  saved: 'Backup codes saved. Two-factor authentication is on: signing in asks for the code from your app.',
} as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid gap-4 border-t border-border-subtle pt-6">
      <h3 className="flex items-baseline gap-3 font-display text-xl [overflow-wrap:anywhere]">
        <span aria-hidden="true" className="font-display text-fg-subtle">
          {n}
        </span>
        <span>{title}</span>
      </h3>
      {children}
    </li>
  );
}

/** A disclosure for a second action of the page (new codes, turning off, starting again). */
function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-t border-border-subtle">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-ui font-semibold [&::-webkit-details-marker]:hidden">
        {summary}
        <span aria-hidden="true" className="text-fg-muted transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="pt-2 pb-6">{children}</div>
    </details>
  );
}

function RegisterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">{label}</dt>
      <dd className="border-b border-border-subtle pb-3 text-ui sm:border-t sm:border-b-0 sm:pt-3">{children}</dd>
    </div>
  );
}

function backupCodesFile(codes: readonly string[]): string {
  const day = new Date().toISOString().slice(0, 10);
  const text = [`WingChunRoots backup codes (${day})`, 'Each code signs you in once, instead of the code from your app.', '', ...codes, ''].join('\n');
  return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
}

export default async function SecurityPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/account/security');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const next = safeNextPath(query.next, '');
  const outcome = query.outcome;
  const tf = await serverClient(await headers(), guard.principal).account.twoFactor();
  const user = guard.principal?.user;
  const newCodes = tf.status === 'on' && query.codes === 'new' && user ? await readBackupCodes(user.id) : null;
  const setup = tf.status === 'pending' && user ? await readPendingSetup(user.id, user.email) : null;
  const notice = (Object.keys(NOTICES) as (keyof typeof NOTICES)[]).find((key) => typeof query[key] === 'string');

  const state: { kind: TwoFactorStateKind; text: string } =
    tf.status === 'off'
      ? { kind: 'off', text: 'Off' }
      : tf.status === 'pending'
        ? { kind: 'pending', text: 'Setup not finished' }
        : tf.sessionVerified
          ? { kind: 'on', text: 'On' }
          : { kind: 'unverified', text: 'On, but this session has not passed the second factor' };

  let body: ReactNode;
  if (tf.status === 'off') {
    body = (
      <div className="grid gap-5">
        <p className="max-w-[56ch] text-ui text-fg-muted">
          Turn it on to be asked, at every sign-in, for the 6-digit code from an authenticator app on your phone.
        </p>
        <EnableTwoFactorForm initial={await readFormResult('enable-two-factor', outcome)} />
      </div>
    );
  } else if (tf.status === 'pending' && !setup) {
    // Started in another browser, or more than 30 minutes ago: the key is not shown again here.
    body = (
      <div className="grid gap-6">
        <p className="max-w-[56ch] text-ui">
          This setup was started in another browser, or more than 30 minutes ago, so its key is not shown here. Start again to get a new
          key; the old one stops working.
        </p>
        <EnableTwoFactorForm restart initial={await readFormResult('enable-two-factor', outcome)} />
        <div>
          <More summary="Already added the key to your app? Enter its code">
            <ConfirmTwoFactorForm initial={await readFormResult('confirm-two-factor', outcome)} />
          </More>
        </div>
      </div>
    );
  } else if (tf.status === 'pending' && setup) {
    const qr = qrModules(setup.uri);
    body = (
      <ol className="grid gap-8">
        <Step n={1} title="Add WingChunRoots to your authenticator app">
          {/* On a phone the app is on the same screen: the key and the app link come first. */}
          <div className="flex flex-col gap-6">
            <div className="grid gap-2 pointer-coarse:order-2">
              <p className="text-ui text-fg-muted">Scan this code with the app.</p>
              <QrCode qr={qr} label="QR code of your two-factor key for WingChunRoots" />
            </div>
            <div className="grid gap-3 pointer-coarse:order-1">
              <p id="totp-key-label" className="text-ui text-fg-muted">
                <span className="pointer-coarse:hidden">Cannot scan? </span>Enter this key in the app (time-based, 6 digits):
              </p>
              <code
                aria-labelledby="totp-key-label"
                translate="no"
                className="w-fit max-w-full rounded-sm border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-lg tracking-wider [overflow-wrap:anywhere] select-all"
              >
                {setup.key}
              </code>
              <div className="flex flex-wrap gap-3">
                <CopyButton text={setup.key.replace(/\s/g, '')} label="Copy key" />
                {/* Only where a tap can open another app: phones and tablets. cn() drops the
                    button's own inline-flex, which would otherwise win over `hidden`. */}
                <a href={setup.uri} className={cn(buttonVariants({ variant: 'secondary' }), 'hidden pointer-coarse:inline-flex')}>
                  <ExternalAppIcon />
                  Open in authenticator app
                </a>
              </div>
            </div>
          </div>
        </Step>
        <Step n={2} title="Enter the code from the app">
          <ConfirmTwoFactorForm initial={await readFormResult('confirm-two-factor', outcome)} />
        </Step>
        <li>
          <More summary="Start again with a new key">
            <EnableTwoFactorForm again initial={await readFormResult('enable-two-factor', outcome)} />
          </More>
        </li>
      </ol>
    );
  } else if (newCodes) {
    body = (
      <section aria-labelledby="codes-heading" className="grid gap-5">
        <h2 id="codes-heading" className="font-display text-2xl [overflow-wrap:anywhere]">
          Save your backup codes
        </h2>
        <p className="max-w-[56ch] text-ui text-fg-muted">
          If you lose your phone, each code signs you in once instead of the code from your app. Keep them with your passwords, in a
          password manager or on paper. They are shown only here, in this browser, for the next 30 minutes.
        </p>
        <ol
          aria-label="Backup codes"
          translate="no"
          className="grid min-w-0 max-w-[30rem] grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-6 gap-y-1.5 rounded-sm border border-border-subtle bg-surface-2 px-5 py-4"
        >
          {newCodes.map((code, i) => (
            <li key={code} className="flex items-baseline gap-3 whitespace-nowrap">
              <span aria-hidden="true" className="w-5 text-right text-sm text-fg-subtle tabular-nums">
                {i + 1}
              </span>
              <span className="font-mono text-lg tracking-wide tabular-nums slashed-zero select-all">{code}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-3">
          <CopyButton text={newCodes.join('\n')} label="Copy all codes" />
          <a href={backupCodesFile(newCodes)} download="wingchunroots-backup-codes.txt" className={buttonVariants({ variant: 'secondary' })}>
            <DownloadIcon />
            Download as a text file
          </a>
        </div>
        {/* A plain GET form: the browser itself asks for the tick, with or without JavaScript. */}
        <form method="get" action="/account/security" className="mt-2 grid gap-4">
          <CheckboxField form="codes" name="saved" label="I have saved these codes somewhere safe." required state={IDLE} />
          <div>
            <button type="submit" className={`${buttonVariants({ variant: 'primary', size: 'lg' })} w-full sm:w-auto sm:min-w-48`}>
              Done
            </button>
          </div>
        </form>
      </section>
    );
  } else if (!tf.sessionVerified) {
    body = (
      <div className="grid gap-4">
        <p className="max-w-[56ch] text-ui">
          {tf.staff
            ? 'Staff pages open only in a session that has passed the second factor. Enter the current code to verify this one.'
            : 'Enter the current code to verify this session.'}
        </p>
        <VerifySessionForm next={next} initial={await readFormResult('verify-session', outcome)} />
      </div>
    );
  } else {
    body = (
      <div className="grid gap-6">
        {query.codes === 'new' ? (
          <p className="max-w-[56ch] text-ui text-fg-muted">
            New backup codes are shown only in the browser that asked for them, for 30 minutes. If you did not save them, get new ones
            below.
          </p>
        ) : null}
        {next ? (
          <p className="text-ui">
            <Link href={next} className="link inline-flex min-h-11 items-center">
              Continue to the page you asked for
            </Link>
          </p>
        ) : null}
        <div>
          <More summary="Get new backup codes">
            <NewBackupCodesForm initial={await readFormResult('new-backup-codes', outcome)} />
          </More>
          {tf.staff ? (
            <p className="border-t border-border-subtle py-4 text-sm text-fg-muted">Staff accounts keep two-factor authentication on.</p>
          ) : (
            <More summary="Turn off two-factor authentication">
              <DisableTwoFactorForm initial={await readFormResult('disable-two-factor', outcome)} />
            </More>
          )}
        </div>
      </div>
    );
  }

  return (
    <AuthFrame
      eyebrow="Account · security"
      title="Two-factor authentication"
      notes={notesFor(tf.status, tf.staff)}
      notesLabel="About two-factor authentication"
    >
      {notice ? <Notice>{NOTICES[notice]}</Notice> : null}
      <dl aria-label="Two-factor authentication" className="mb-8 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[9rem_minmax(0,1fr)]">
        <RegisterRow label="Status">
          <TwoFactorState state={state.kind} className="font-semibold">
            {state.text}
          </TwoFactorState>
        </RegisterRow>
        {tf.status === 'on' ? (
          <RegisterRow label="Backup codes">
            {tf.backupCodesLeft === 1 ? '1 left' : `${tf.backupCodesLeft ?? 0} of ${BACKUP_CODE_COUNT} left`}
            {(tf.backupCodesLeft ?? 0) <= 3 && !newCodes ? <span className="text-fg-muted"> · get new ones below</span> : null}
          </RegisterRow>
        ) : null}
        <RegisterRow label="Sign-in">
          {tf.status === 'on'
            ? 'Your password, then the code from your app (or a backup code).'
            : tf.status === 'pending'
              ? 'Still only your password, until you enter the first code below.'
              : 'Only your password.'}
        </RegisterRow>
      </dl>
      {body}
      <p className="mt-10 border-t border-border-subtle pt-5 text-ui">
        <Link href="/account" className="link inline-flex min-h-11 items-center">
          Back to your account
        </Link>
      </p>
    </AuthFrame>
  );
}
