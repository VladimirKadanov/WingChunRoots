'use client';

// The shortcut help (plan §4.9; milestone M06, package A): a dialog named "Keyboard shortcuts"
// that lists SHORTCUTS, opened with "?" in the graph or the button over the canvas, loaded lazily
// inside the canvas chunk. Esc returns the focus to the active node.
//
// Package F's stub: nothing is shown.

import type { ReactNode } from 'react';

export interface ShortcutHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ShortcutHelp: (props: ShortcutHelpProps) => ReactNode = () => null;
