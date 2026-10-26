import { describe, expect, it } from 'vitest';

import { isSearchShortcut, type ShortcutKey } from './search-shortcut';

const press = (key: string, code: string, mods: Partial<ShortcutKey> = { ctrlKey: true }): ShortcutKey => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('isSearchShortcut', () => {
  it('opens on Ctrl+K and ⌘+K', () => {
    expect(isSearchShortcut(press('k', 'KeyK'))).toBe(true);
    expect(isSearchShortcut(press('K', 'KeyK'))).toBe(true);
    expect(isSearchShortcut(press('k', 'KeyK', { metaKey: true }))).toBe(true);
  });

  it('opens on a Cyrillic layout, where the key reports its own letter', () => {
    // The Bulgarian and Russian layouts put "к" or "л" on the physical K key.
    expect(isSearchShortcut(press('л', 'KeyK'))).toBe(true);
    expect(isSearchShortcut(press('к', 'KeyK'))).toBe(true);
    expect(isSearchShortcut(press('Л', 'KeyK'))).toBe(true);
  });

  it("follows a Latin layout's own k (Dvorak, AZERTY), not the physical key", () => {
    // Dvorak: the physical KeyK is "t", and "k" sits on KeyV.
    expect(isSearchShortcut(press('t', 'KeyK'))).toBe(false);
    expect(isSearchShortcut(press('k', 'KeyV'))).toBe(true);
  });

  it('needs Ctrl or ⌘, and no Alt or Shift', () => {
    expect(isSearchShortcut(press('k', 'KeyK', {}))).toBe(false);
    expect(isSearchShortcut(press('л', 'KeyK', {}))).toBe(false);
    expect(isSearchShortcut(press('k', 'KeyK', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSearchShortcut(press('K', 'KeyK', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(press('л', 'KeyL'))).toBe(false);
  });
});
