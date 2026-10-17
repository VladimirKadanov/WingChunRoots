// Milestone M01b, Done when 3: every template renders its sample data to HTML and to plain text,
// has a subject and leaves no unreplaced variable; names keep their `lang` attribute.

import { describe, expect, it } from 'vitest';

import { EMAIL_TEMPLATES, type EmailTemplate, renderEmail, TemplateDataError, type NameData } from './email';
import { NOTIFICATION_TEMPLATES, NotificationDataError, renderNotification } from './notifications';

// What a missing or mistyped variable leaves behind in the output.
const UNREPLACED = /\{\{|\}\}|\$\{|\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/;

/** Every string the sample data shows, however deeply nested (a name's `lang` is an attribute). */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => (key === 'lang' ? [] : strings(v)));
  }
  return [];
}

/** Every name ({ value, lang }) in the sample data. */
function names(value: unknown): NameData[] {
  if (Array.isArray(value)) return value.flatMap(names);
  if (value && typeof value === 'object') {
    const { value: text, lang } = value as Partial<NameData>;
    if (typeof text === 'string' && typeof lang === 'string') return [{ value: text, lang }];
    return Object.values(value).flatMap(names);
  }
  return [];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

describe('e-mail templates', () => {
  const entries = Object.entries(EMAIL_TEMPLATES) as [keyof typeof EMAIL_TEMPLATES, EmailTemplate<unknown>][];

  it('the registry is not empty and every key is the template name', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, template] of entries) expect(template.name).toBe(key);
  });

  for (const [name, template] of entries) {
    describe(name, () => {
      it('renders the sample data to HTML and plain text with a subject and no unreplaced variable', async () => {
        const email = await renderEmail(name, template.sample);
        expect(email.subject.trim().length).toBeGreaterThan(0);
        expect(email.subject).not.toMatch(/\n/);
        expect(email.html).toMatch(/^<!DOCTYPE html/i);
        expect(email.html).toMatch(/<html[^>]*\blang="en"/);
        expect(email.text.trim().length).toBeGreaterThan(0);
        expect(email.text).not.toMatch(/<[a-z!/][^>]*>/i);
        for (const [part, value] of Object.entries(email)) expect(value, part).not.toMatch(UNREPLACED);
        expect(template.preview(template.sample)).not.toMatch(UNREPLACED);
        for (const s of strings(template.sample)) {
          expect(email.text, `text contains ${s}`).toContain(s);
        }
      });

      it('shows every name with its lang attribute and translate="no"', async () => {
        const { html } = await renderEmail(name, template.sample);
        const sampleNames = names(template.sample);
        expect(sampleNames.length).toBeGreaterThan(0);
        for (const n of sampleNames) {
          expect(html).toContain(`<span lang="${n.lang}" translate="no">${escapeHtml(n.value)}</span>`);
        }
      });

      it('parses its own sample data unchanged', () => {
        expect(template.parse(template.sample)).toEqual(template.sample);
      });
    });
  }

  it('refuses an unknown template and data the template cannot render', async () => {
    await expect(renderEmail('no-such-template', {})).rejects.toBeInstanceOf(TemplateDataError);
    await expect(renderEmail('mail-check', null)).rejects.toBeInstanceOf(TemplateDataError);
    await expect(renderEmail('mail-check', { recipientNames: [] })).rejects.toThrow(/1 to 4 names/);
    await expect(renderEmail('mail-check', { recipientNames: [{ value: '示範學生', lang: 'zh-Hant' }] })).rejects.toThrow(
      /Latin-script/,
    );
    await expect(renderEmail('mail-check', { recipientNames: [{ value: 'Demo Student', lang: 'not a tag' }] })).rejects.toThrow(
      /BCP 47/,
    );
  });

  it('mail-check without recipient names greets without a name (pnpm mail:check without --name)', async () => {
    expect(EMAIL_TEMPLATES['mail-check'].parse({})).toEqual({ recipientNames: [] });
    const { text, html } = await renderEmail('mail-check', {});
    expect(text).toContain('Hello,');
    expect(html).not.toContain('translate="no"');
  });

  it('escapes markup in the data', async () => {
    const { html } = await renderEmail('mail-check', { recipientNames: [{ value: 'Demo <b>Student</b>', lang: 'en' }] });
    expect(html).not.toContain('<b>Student</b>');
    expect(html).toContain('Demo &lt;b&gt;Student&lt;/b&gt;');
  });
});

describe('account e-mails (M02)', () => {
  const cases = [
    { name: 'verify-email', path: '/verify-email', subject: /Confirm your e-mail address/ },
    { name: 'reset-password', path: '/reset-password', subject: /Reset your WingChunRoots password/ },
  ] as const;

  for (const { name, path, subject } of cases) {
    describe(name, () => {
      const url = `http://127.0.0.1:3100${path}?token=demo-token-123`;

      it('shows the link as a button and as text, and how long it works, without a name before onboarding', async () => {
        const email = await renderEmail(name, { url, expiresInHours: 1 });
        expect(email.subject).toMatch(subject);
        expect(email.html).toContain(`href="${url.replaceAll('&', '&amp;')}"`);
        expect(email.text).toContain(url);
        expect(email.text).toContain('Hello,');
        expect(email.text).toContain('1 hour ');
        expect(email.html).not.toContain('translate="no"');
      });

      it('refuses a link to another page, without a token or not over http(s), and odd lifetimes', async () => {
        await expect(renderEmail(name, { url: 'http://127.0.0.1:3100/elsewhere?token=x', expiresInHours: 1 })).rejects.toThrow(
          new RegExp(`point at ${path}`),
        );
        await expect(renderEmail(name, { url: `http://127.0.0.1:3100${path}`, expiresInHours: 1 })).rejects.toThrow(/with a token/);
        await expect(renderEmail(name, { url: `javascript:alert(1)//${path}?token=x`, expiresInHours: 1 })).rejects.toThrow(/http\(s\)/);
        await expect(renderEmail(name, { url, expiresInHours: 0 })).rejects.toThrow(/hours/);
        await expect(renderEmail(name, { url, expiresInHours: 1.5 })).rejects.toThrow(/hours/);
        await expect(renderEmail(name, { url })).rejects.toBeInstanceOf(TemplateDataError);
      });
    });
  }
});

describe('notification templates', () => {
  const entries = Object.entries(NOTIFICATION_TEMPLATES);

  it('the registry is not empty and every key is the template name', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, template] of entries) expect(template.name).toBe(key);
  });

  for (const [name, template] of entries) {
    it(`${name} renders the sample data with a title, a body and no unreplaced variable`, () => {
      const rendered = renderNotification(name, template.sample);
      expect(rendered.title.trim().length).toBeGreaterThan(0);
      expect(rendered.body.length).toBeGreaterThan(0);
      expect(rendered.title).not.toMatch(UNREPLACED);
      for (const segment of rendered.body) {
        const text = 'text' in segment ? segment.text : segment.name.value;
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(UNREPLACED);
      }
    });
  }

  it('refuses an unknown template', () => {
    expect(() => renderNotification('no-such-template', {})).toThrow(NotificationDataError);
  });
});
