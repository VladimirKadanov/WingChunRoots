'use client';

// The shortcut help (plan §4.9; milestone M06, package A): a dialog named "Keyboard shortcuts"
// that lists SHORTCUTS, opened with "?" in the graph or the "Keyboard shortcuts" button over the
// canvas, loaded lazily from the canvas chunk (keys.tsx). Esc or Close returns the focus to where
// it was when the dialog opened: the active node, or the button (the Dialog's own return of the
// focus, Base UI).

import { Dialog } from '@/components/ui/dialog';

import { SHORTCUTS } from './shortcuts';

export interface ShortcutHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutHelp({ open, onOpenChange }: ShortcutHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="These keys work while the focus is in the lineage graph.">
      <table data-testid="shortcut-table" className="w-full border-collapse text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Key</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((shortcut) => (
            <tr key={shortcut.action} className="border-t border-border-subtle first:border-t-0">
              <th scope="row" className="w-20 py-2 pr-3 text-left align-top font-normal">
                <kbd className="inline-block min-w-8 rounded-xs border border-border-strong bg-surface-1 px-1.5 text-center font-sans text-sm leading-6 text-fg">
                  {shortcut.key}
                </kbd>
              </th>
              <td className="py-2 align-top text-fg">{shortcut.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
