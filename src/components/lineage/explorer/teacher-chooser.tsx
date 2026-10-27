'use client';

// The teacher chooser (plan §4.9; milestone M06, package A): ↑ on a person with two or more
// teachers drawn opens a menu anchored to the node, display-primary first (DEFAULT D05, nav.ts),
// with the first teacher highlighted, as a menu opened from the keyboard is (↑ ↓ move, Enter
// chooses); choosing one moves the focus there (keys.tsx), Esc closes it and the focus goes back
// to the person (the menu's own return of the focus to the element focused before it opened).
//
// The app's menu (src/components/ui/menu.tsx, Base UI), opened by the keys rather than by a
// trigger and placed above the node (the teachers are above). It is rendered into <main>, so its
// items stay inside a landmark (axe "region"). Non-modal: a click outside closes it and lands where
// it was meant to. Its items are 44 px tall (MenuItem); the names are not translated.

import { useRef } from 'react';

import { MenuContent, MenuItem, MenuRoot } from '@/components/ui/menu';

export interface TeacherChooserProps {
  /** The node the menu is anchored to. */
  anchor: HTMLElement | null;
  /** The menu's name, e.g. "Teachers of {name}". */
  label: string;
  /** The teachers to choose from, in order. */
  teachers: readonly { id: string; name: string }[];
  onChoose: (id: string) => void;
  onClose: () => void;
}

export function TeacherChooser({ anchor, label, teachers, onChoose, onClose }: TeacherChooserProps) {
  // A teacher chosen takes the focus itself (keys.tsx): the menu then does not move it back to the person.
  const chosen = useRef(false);
  // The menu's first focus goes to the first teacher, which is then highlighted (a menu opened by
  // the keys has no trigger to tell it so); it notes where the focus was before (the person) first.
  const first = useRef<HTMLDivElement>(null);
  return (
    <MenuRoot
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <MenuContent anchor={anchor} label={label} side="top" align="center" sideOffset={8} className="min-w-56" initialFocus={first} finalFocus={() => !chosen.current}>
        {teachers.map((teacher, index) => (
          <MenuItem
            key={teacher.id}
            ref={index === 0 ? first : undefined}
            label={teacher.name}
            onClick={() => {
              chosen.current = true;
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
