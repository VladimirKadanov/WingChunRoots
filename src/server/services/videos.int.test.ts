// The videos of a profile (ADR 0050): YouTube or Vimeo links only, stored as provider and id; as
// many as the plan includes, shown only while public; kept on a lower plan; staff remove one with a
// reason the owner is sent.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, entitlementGrant, notification, personVideo } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { member, meta, staff } from './relationships.test-support';
import { myProfileVideos, parseVideoUrl, profileVideos, removeProfileVideo, setProfileVideos } from './videos';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const grant = async (userId: string, planCode: 'premium_student' | 'pro_sifu' = 'premium_student') => {
  const [row] = await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode, source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: ADR 0050 test plan' })
    .returning({ id: entitlementGrant.id });
  return row!.id;
};
const endGrant = (id: string) => getDb().update(entitlementGrant).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(entitlementGrant.id, id));

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'answered',
    (error: { code?: string }) => error.code,
  );

describe('the address of a video', () => {
  it('takes YouTube and Vimeo videos only, as provider and id', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=abcDEF12345&t=10')).toEqual({ provider: 'youtube', videoId: 'abcDEF12345' });
    expect(parseVideoUrl(' https://youtu.be/abcDEF12345 ')).toEqual({ provider: 'youtube', videoId: 'abcDEF12345' });
    expect(parseVideoUrl('https://www.youtube.com/shorts/abc_EF-2345')).toEqual({ provider: 'youtube', videoId: 'abc_EF-2345' });
    expect(parseVideoUrl('https://vimeo.com/123456789')).toEqual({ provider: 'vimeo', videoId: '123456789' });
    expect(parseVideoUrl('https://player.vimeo.com/video/123456789')).toEqual({ provider: 'vimeo', videoId: '123456789' });
    expect(parseVideoUrl('http://www.youtube.com/watch?v=abcDEF12345')).toBeNull();
    expect(parseVideoUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseVideoUrl('https://example.test/watch?v=abcDEF12345')).toBeNull();
    expect(parseVideoUrl('https://youtube.com.example.test/watch?v=abcDEF12345')).toBeNull();
    expect(parseVideoUrl('https://vimeo.com/channels/demo')).toBeNull();
    expect(parseVideoUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('profile videos (ADR 0050)', () => {
  it('are saved up to the plan quota, shown while public, and kept but not shown after the plan ends', async () => {
    const student = await member('videos-student');
    const videos = [
      { title: 'Demo Siu Nim Tao', url: 'https://www.youtube.com/watch?v=abcDEF12345' },
      { title: '  Demo   chi sau ', url: 'https://vimeo.com/123456789' },
    ];
    expect(await codeOf(setProfileVideos(student.principal, { videos }, meta))).toBe('ENTITLEMENT_REQUIRED');
    expect((await myProfileVideos(student.principal)).limit).toBe(0);

    const grantId = await grant(student.account.id);
    expect((await myProfileVideos(student.principal)).limit).toBe(2);
    const saved = await setProfileVideos(student.principal, { videos }, meta);
    expect(saved.videos.map((v) => [v.title, v.provider, v.videoId])).toEqual([
      ['Demo Siu Nim Tao', 'youtube', 'abcDEF12345'],
      ['Demo chi sau', 'vimeo', '123456789'],
    ]);
    expect((await profileVideos(null, { slug: student.slug })).videos.map((v) => v.videoId)).toEqual(['abcDEF12345', '123456789']);
    const audited = await getDb().select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.subjectId, student.personId), eq(auditLog.action, 'person.videos')));
    expect(audited).toEqual([{ after: { videos: 2 } }]);

    // Over the quota; field errors name the row; nothing is saved.
    expect(await codeOf(setProfileVideos(student.principal, { videos: [...videos, { title: 'Demo three', url: 'https://youtu.be/abcDEF12399' }] }, meta))).toBe('BAD_REQUEST');
    const bad = (await setProfileVideos(student.principal, { videos: [videos[0]!, { title: '', url: 'https://example.test/v' }] }, meta).catch((e: unknown) => e)) as { code: string; fields: Record<string, string> };
    expect(bad.code).toBe('BAD_REQUEST');
    expect(Object.keys(bad.fields).sort()).toEqual(['videos.1.title', 'videos.1.url']);

    await endGrant(grantId);
    expect((await profileVideos(null, { slug: student.slug })).videos).toEqual([]);
    const own = await myProfileVideos(student.principal);
    expect(own.limit).toBe(0);
    expect(own.videos.map((v) => v.url)).toEqual(['https://www.youtube.com/watch?v=abcDEF12345', 'https://vimeo.com/123456789']);
  });

  it('are NOT_FOUND for a person who is not public, whatever the plan', async () => {
    const hidden = await member('videos-hidden', { hidden: true });
    await grant(hidden.account.id);
    await setProfileVideos(hidden.principal, { videos: [{ title: 'Demo', url: 'https://youtu.be/abcDEF12345' }] }, meta);
    expect(await codeOf(profileVideos(null, { slug: hidden.slug }))).toBe('NOT_FOUND');
  });

  it('can be removed by staff with a verified second factor and a reason the owner is sent', async () => {
    const owner = await member('videos-owner', { sifu: true });
    await grant(owner.account.id, 'pro_sifu');
    const { videos } = await setProfileVideos(
      owner.principal,
      {
        videos: [
          { title: 'Demo one', url: 'https://youtu.be/abcDEF12341' },
          { title: 'Demo two', url: 'https://youtu.be/abcDEF12342' },
          { title: 'Demo three', url: 'https://youtu.be/abcDEF12343' },
        ],
      },
      meta,
    );
    const moderator = await staff('videos-moderator');
    const reason = 'Demo: the video is not about Wing Chun.';
    expect(await codeOf(removeProfileVideo(owner.principal, { id: videos[1]!.id, reason }, meta))).toBe('FORBIDDEN');
    expect(await codeOf(removeProfileVideo(moderator.principal, { id: videos[1]!.id, reason: ' ' }, meta))).toBe('BAD_REQUEST');
    expect(await removeProfileVideo(moderator.principal, { id: videos[1]!.id, reason }, meta)).toEqual({ id: videos[1]!.id, removed: true });
    const left = await getDb().select({ title: personVideo.title, position: personVideo.position }).from(personVideo).where(eq(personVideo.personId, owner.personId)).orderBy(personVideo.position);
    expect(left).toEqual([
      { title: 'Demo one', position: 0 },
      { title: 'Demo three', position: 1 },
    ]);
    const [audit] = await getDb().select({ reason: auditLog.reason }).from(auditLog).where(and(eq(auditLog.subjectId, videos[1]!.id), eq(auditLog.action, 'person.video_remove')));
    expect(audit?.reason).toBe(reason);
    const told = await getDb().select({ payload: notification.payload }).from(notification).where(and(eq(notification.userId, owner.account.id), eq(notification.template, 'content.removed')));
    expect(told).toEqual([{ payload: { content: 'profile_video', reason } }]);
  });
});
