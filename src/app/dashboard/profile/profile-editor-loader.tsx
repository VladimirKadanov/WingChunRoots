'use client';

// The profile editor in a client bundle of its own (milestone M07; plan §5.8 (c): at most 170 kB
// of initial JavaScript per route). next/dynamic with server rendering: the server renders the
// whole form, which is a plain HTML form that posts without JavaScript (profile-editor.tsx), and
// the browser fetches the editor's code (TanStack Form, the Zod Mini rules) at once, beside the
// page's own instead of inside it. The shell and the links hydrate without waiting for it; the
// form becomes the TanStack editor when its chunk has arrived.
//
// DEFAULT (M07, recorded in docs/adr/0001-stack.md): the budget counts the route's initial
// JavaScript, so the editor's chunk is outside it, as the search palette's is; its size is in the
// M07 Progress log.

import dynamic from 'next/dynamic';

export const ProfileEditorLoader = dynamic(() => import('./profile-editor').then((m) => m.ProfileEditor));
