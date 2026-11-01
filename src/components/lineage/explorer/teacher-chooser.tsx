'use client';

// The teacher chooser (plan §4.9; milestone M06, package A): ↑ on a person with two or more
// teachers drawn opens a menu anchored to the node, display-primary first (DEFAULT D05, nav.ts),
// with the first teacher highlighted, as a menu opened from the keyboard is (↑ ↓ move, Enter
// chooses); choosing one moves the focus there, Esc closes it and the focus goes back to the person
// (the menu's own return of the focus to the element focused before it opened). The menu hands the
// focus straight to the teacher chosen when it closes (its final focus): never to the page in
// between, where a screen reader loses its place (M10b review, CI). A teacher that is not drawn
// takes it from the person once the view has brought it in (keys.tsx, canvas.tsx setActive).
//
// The app's menu (src/components/ui/menu.tsx, Base UI), opened by the keys rather than by a
// trigger and placed above the node (the teachers are above). It is rendered into <main>, so its
// items stay inside a landmark (axe "region"). Modal (ADR 0010): a non-modal Base UI menu puts
// focusable guards with aria-hidden around its portalled popup (axe "aria-hidden-focus"); a modal
// one closes with a click outside, and that click does not reach what lies under it (the price of
// passing axe without disabling a rule). Its items are 44 px tall (MenuItem); the names are not
// translated.

import { useRef } from 'react';

import { MenuContent, MenuItem, MenuRoot } from '@/components/ui/menu';

export interface TeacherChooserProps {
  /** The node the menu is anchored to. */
  anchor: HTMLElement | null;
  /** The drawn node of a teacher, which takes the focus when the menu closes; null when not drawn. */
  elementOf: (id: string) => HTMLElement | null;
  /** The menu's name, e.g. "Teachers of {name}". */
  label: string;
  /** The teachers to choose from, in order. */
  teachers: readonly { id: string; name: string }[];
  onChoose: (id: string) => void;
  onClose: () => void;
}

export function TeacherChooser({ anchor, elementOf, label, teachers, onChoose, onClose }: TeacherChooserProps) {
  // The teacher chosen: the menu's final focus is that teacher's node, else (Esc, or a teacher not
  // drawn) the person's, the element focused before it opened (`true`).
  const chosen = useRef<string | null>(null);
  // The menu's first focus goes to the first teacher, which is then highlighted (a menu opened by
  // the keys has no trigger to tell it so); it notes where the focus was before (the person) first.
  const first = useRef<HTMLDivElement>(null);
  return (
    <MenuRoot
      open
      modal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <MenuContent anchor={anchor} label={label} side="top" align="center" sideOffset={8} className="min-w-56" initialFocus={first} finalFocus={() => (chosen.current ? (elementOf(chosen.current) ?? true) : true)}>
        {teachers.map((teacher, index) => (
          <MenuItem
            key={teacher.id}
            ref={index === 0 ? first : undefined}
            label={teacher.name}
            onClick={() => {
              chosen.current = teacher.id;
              onChoose(teacher.id);
            }}
          >
            <span lang="und-Latn" translate="no" className="truncate">
              {teacher.name}
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
