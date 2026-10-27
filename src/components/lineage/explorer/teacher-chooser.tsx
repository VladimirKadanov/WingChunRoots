'use client';

// The teacher chooser (plan §4.9; milestone M06, package A): ↑ on a person with two or more
// teachers drawn opens a menu anchored to the node, display-primary first (DEFAULT D05); choosing
// one moves the focus there, Esc closes it and the focus stays on the person.
//
// Package F's stub: nothing is shown.

import type { ReactNode } from 'react';

export interface TeacherChooserProps {
  /** The node the menu is anchored to. */
  anchor: HTMLElement | null;
  /** The teachers to choose from, in order. */
  teachers: readonly { id: string; name: string }[];
  onChoose: (id: string) => void;
  onClose: () => void;
}

export const TeacherChooser: (props: TeacherChooserProps) => ReactNode = () => null;
