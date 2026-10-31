'use client';

// A <div> that takes the focus each time React shows it (M09 review, screens-1): the outcome note
// of the teacher-request pages (OutcomeNote, ./parts.tsx). After a Server Action's redirect the
// router renders the page hidden (React Activity) and then shows it, so `autofocus` never fires;
// React attaches a ref when the element is shown, also when a page kept hidden is shown again
// (Back). Everything else comes from the server component, so this island stays a few bytes.

import type { ComponentProps } from 'react';

const focus = (el: HTMLDivElement | null) => {
  el?.focus();
};

export function FocusOnShow(props: Omit<ComponentProps<'div'>, 'ref'>) {
  return <div {...props} ref={focus} />;
}
