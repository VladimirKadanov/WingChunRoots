import { describe, expect, it } from 'vitest';

import { isLikelyBot } from './bots';

describe('isLikelyBot (M21, DEFAULT M21 question 7)', () => {
  it('leaves out a missing or very short user agent', () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot('')).toBe(true);
    expect(isLikelyBot('x')).toBe(true);
  });

  it('leaves out crawlers, link previews, monitors, scripts and headless browsers', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'curl/8.5.0',
      'python-requests/2.32',
      'Mozilla/5.0 (compatible; UptimeRobot/2.0)',
      'Chrome-Lighthouse',
    ]) {
      expect(isLikelyBot(ua), ua).toBe(true);
    }
  });

  it('counts ordinary browsers', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    ]) {
      expect(isLikelyBot(ua), ua).toBe(false);
    }
  });
});
