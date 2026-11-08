// The dates of the activity check (milestone M20; DEFAULT D17) and the words of its notices
// (CLAUDE.md §11: the date to answer by, no countdown, no blame).

import { describe, expect, it } from 'vitest';

import { renderNotification } from '../templates/notifications';
import { activityOf, hiddenFrom, SCHOOL_AWAITING_DAYS, SCHOOL_CONFIRM_GRACE_DAYS, SCHOOL_HIDDEN_DAYS } from './school-activity';

const DAY = 86_400_000;
const text = (template: string, payload: unknown) =>
  renderNotification(template, payload)
    .body.map((segment) => ('text' in segment ? segment.text : segment.name.value))
    .join('');

describe('the stages of the activity check', () => {
  it('asks on day 90 and hides on day 105, with two weeks between the request and the hiding', () => {
    expect([SCHOOL_AWAITING_DAYS, SCHOOL_HIDDEN_DAYS, SCHOOL_CONFIRM_GRACE_DAYS]).toEqual([90, 105, 14]);
  });

  it('hides on day 105 when the request came on day 90', () => {
    const last = new Date('2026-08-03T09:00:00Z');
    const asked = new Date(last.getTime() + 90 * DAY);
    expect(hiddenFrom(last, asked)).toEqual(new Date(last.getTime() + 105 * DAY));
  });

  it('never hides less than 14 days after a late request (a missed run)', () => {
    const last = new Date('2026-07-01T09:00:00Z');
    const asked = new Date(last.getTime() + 104 * DAY);
    expect(hiddenFrom(last, asked)).toEqual(new Date(asked.getTime() + 14 * DAY));
  });

  it('activityOf gives the label, the dates and the hiding day only while awaiting', () => {
    const last = new Date('2026-08-03T09:00:00Z');
    const asked = new Date('2026-11-02T05:23:00Z');
    expect(activityOf({ activityStage: 'current', lastActivityAt: last, activityAwaitingSince: null, activityHiddenAt: null })).toEqual({
      stage: 'current',
      label: 'Current',
      lastActivityAt: last.toISOString(),
      awaitingSince: null,
      hiddenAt: null,
      hiddenFrom: null,
    });
    const awaiting = activityOf({ activityStage: 'awaiting_confirmation', lastActivityAt: last, activityAwaitingSince: asked, activityHiddenAt: null });
    expect(awaiting).toMatchObject({ label: 'Awaiting confirmation', awaitingSince: asked.toISOString(), hiddenFrom: '2026-11-16T09:00:00.000Z' });
    const hiddenAt = new Date('2026-11-16T09:00:00Z');
    expect(activityOf({ activityStage: 'hidden', lastActivityAt: last, activityAwaitingSince: asked, activityHiddenAt: hiddenAt })).toMatchObject({
      label: 'Hidden from the map',
      hiddenAt: hiddenAt.toISOString(),
      hiddenFrom: null,
    });
  });
});

describe('the activity notices', () => {
  const awaiting = { schoolId: '0190a5c0-0000-7000-8000-0000000000c1', name: 'Demo Wing Chun Hall', lastActivityAt: '2026-08-03T09:00:00.000Z', confirmBy: '2026-11-16T09:00:00.000Z' };

  it('asks the owner with the last activity and an approximate date, and links to the school', () => {
    const rendered = renderNotification('school.activity-awaiting', { ...awaiting, organizationId: null });
    expect(rendered.title).toBe('Is your school listing still current?');
    expect(rendered.action).toEqual({ label: 'Confirm the listing', href: `/dashboard/schools/${awaiting.schoolId}` });
    const body = text('school.activity-awaiting', { ...awaiting, organizationId: null });
    expect(body).toContain('3 August 2026');
    expect(body).toContain('about 16 November 2026');
    expect(body).toContain('Nothing is deleted');
  });

  it('tells an organization admin, who needs to do nothing, and links to the organization', () => {
    const organizationId = '0190a5c0-0000-7000-8000-0000000000d1';
    const rendered = renderNotification('school.activity-awaiting', { ...awaiting, organizationId });
    expect(rendered.action?.href).toContain(organizationId);
    expect(text('school.activity-awaiting', { ...awaiting, organizationId })).toContain('You do not need to do anything');
  });

  it('says how to show a hidden listing again', () => {
    const payload = { schoolId: awaiting.schoolId, name: 'Demo Wing Chun Hall', lastActivityAt: '2026-07-01T09:00:00.000Z' };
    const rendered = renderNotification('school.activity-hidden', payload);
    expect(rendered.action).toEqual({ label: 'Show it again', href: `/dashboard/schools/${awaiting.schoolId}` });
    expect(text('school.activity-hidden', payload)).toContain('This listing is current');
  });

  it('never tells a listing that was not on the map (a Free Sifu, DEFAULT D18) that it leaves the map', () => {
    const awaitingText = text('school.activity-awaiting', { ...awaiting, organizationId: null, onMap: false });
    expect(awaitingText).toContain('It is not on the public map now, because a public pin needs Professional Sifu');
    expect(awaitingText).not.toContain('no longer shown');
    const payload = { schoolId: awaiting.schoolId, name: 'Demo Wing Chun Hall', lastActivityAt: '2026-07-01T09:00:00.000Z', onMap: false };
    expect(renderNotification('school.activity-hidden', payload).title).toBe('Your school listing is marked as not current');
    expect(text('school.activity-hidden', payload)).not.toContain('no longer shown');
    // An older payload without the flag reads as on the map.
    expect(text('school.activity-hidden', { ...payload, onMap: undefined })).toContain('no longer shown on the public map');
    expect(() => renderNotification('school.activity-hidden', { ...payload, onMap: 'no' })).toThrow();
  });

  it('carries no countdown, urgency or blame', () => {
    const all = [
      text('school.activity-awaiting', { ...awaiting, organizationId: null }),
      text('school.activity-awaiting', { ...awaiting, organizationId: '0190a5c0-0000-7000-8000-0000000000d1' }),
      text('school.activity-hidden', { schoolId: awaiting.schoolId, name: 'Demo', lastActivityAt: '2026-07-01T09:00:00.000Z' }),
    ].join(' ');
    expect(all).not.toMatch(/\b(urgent|hurry|last chance|only \d+ days?|days? left|immediately|warning|failed to|neglect)/i);
    expect(all).not.toContain('!');
  });

  it('refuses a payload without a valid school, name or date', () => {
    expect(() => renderNotification('school.activity-awaiting', { ...awaiting, schoolId: '../x', organizationId: null })).toThrow();
    expect(() => renderNotification('school.activity-awaiting', { ...awaiting, confirmBy: 'soon', organizationId: null })).toThrow();
    expect(() => renderNotification('school.activity-hidden', { schoolId: awaiting.schoolId, name: '', lastActivityAt: '2026-07-01T09:00:00.000Z' })).toThrow();
  });
});
