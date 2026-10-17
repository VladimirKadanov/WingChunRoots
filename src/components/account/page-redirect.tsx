'use client';

// The redirect of a guarded page (milestone M02): to sign-in without a session, to
// /account/security for a staff session that has not passed the second factor.
//
// A page with Cache Components streams after its static shell has gone out with status 200, so a
// redirect() thrown there becomes a client-side redirect inside the router. React Activity then
// keeps that route, with the redirect, among the hidden earlier routes, and a later visit to the
// same URL in the same tab repeats the old redirect even when the session now qualifies
// (docs/adr/0004-auth.md). This component leaves the router out of it: a full page load with
// location.replace(), a meta refresh inside <noscript> for browsers without JavaScript, and a
// plain link until either runs.

import { useEffect } from 'react';

function labels(to: string): { title: string; link: string } {
  if (to.startsWith('/sign-in')) return { title: 'Sign in to continue', link: 'Go to sign-in' };
  if (to.startsWith('/account/security')) return { title: 'Verify this session to continue', link: 'Go to the security page' };
  return { title: 'Taking you on', link: 'Continue' };
}

export function PageRedirect({ to, title: heading }: { to: string; title?: string }) {
  const { title, link } = labels(to);
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11">
      <noscript>
        <meta httpEquiv="refresh" content={`0;url=${to}`} />
      </noscript>
      <h1 className="font-display text-feature">{heading ?? title}</h1>
      <p className="mt-3 text-ui">
        <a href={to} className="link inline-flex min-h-11 items-center">
          {link}
        </a>
      </p>
    </div>
  );
}
