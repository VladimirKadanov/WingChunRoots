import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps a token size and a token colour together', () => {
    expect(cn('text-caption text-fg')).toBe('text-caption text-fg');
  });
  it('lets a later size or colour win', () => {
    expect(cn('text-sm text-fg', 'text-lg text-fg-muted')).toBe('text-lg text-fg-muted');
  });
  it('merges token radii', () => {
    expect(cn('rounded-md', 'rounded-sheet')).toBe('rounded-sheet');
  });
});
