import { describe, expect, it } from 'vitest';

import { drawable } from './og-text';

describe('drawable', () => {
  it('keeps Latin, Greek and Cyrillic text with digits and punctuation', () => {
    expect(drawable('Demo Wing Chun · Sofia (No. 2)')).toBe('Demo Wing Chun · Sofia (No. 2)');
    expect(drawable('Демо школа Αθήνα')).toBe('Демо школа Αθήνα');
  });

  it('leaves out other scripts and emoji, and the spaces they leave', () => {
    expect(drawable('詠春 Demo 🥋 School')).toBe('Demo School');
    expect(drawable('詠春')).toBe('');
  });
});
