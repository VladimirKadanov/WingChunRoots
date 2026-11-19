// The videos of a profile (owner decisions 2026-11-18, docs/adr/0044-premium-student.md and
// docs/adr/0050-video-embeds.md): links to YouTube or Vimeo videos, never uploads, as many as the
// plan's `videos` quota (Premium Student 2, Professional Sifu 20; DEFAULT D07).
//
//   people.videos         public: the videos of a public person, as many as their plan includes
//   profile.videos        the account's own videos, its quota and whether it may change them
//   profile.setVideos     replace them, in order (a title and a YouTube or Vimeo address); audited
//   profile.removeVideo   staff with a verified second factor, with a reason; the owner is told
//
// Only the provider and the video's id are stored, never a free address, so a profile can only
// ever embed https://www.youtube-nocookie.com/embed/<id> or https://player.vimeo.com/video/<id>,
// and only when a visitor asks for it (the page shows a "Play" link first, and no thumbnail of a
// third party). Paying never shows anyone: read only for a person in v_public_person. On a lower
// plan the videos are kept; the profile shows as many as the plan includes, the first ones (DEFAULT
// D08). The public answer is the same for every viewer, so it is cached for minutes (the plan can
// end by date), like the links of ADR 0047. Audit rows carry counts and ids, never a title.

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, personTag, tagCacheEntry } from '../cache';
import { getDb } from '../db';
import { person, personVideo } from '../db/schema';
import { PROFILE_VIDEO_TITLE_MAX, PROFILE_VIDEOS_MAX, type VIDEO_PROVIDERS } from '../db/schema/common';
import { SLUG_PATTERN } from '../db/schema/persons';
import { type ProfileVideosDto, toPublicProfileVideos } from '../dto/public';
import { effectivePlan, effectivePlansOf, type Executor } from '../entitlements/access';
import { feature, type PlanCode } from '../entitlements/plans';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notify } from './notify';

export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

const NO_PROFILE = 'You have no profile yet. Finish setting up your profile first.';
const NEEDS_PLAN = 'Videos on your profile are part of Premium Student and Professional Sifu.';
const NO_VIDEO = 'No such video.';
const TITLE_MESSAGE = `Give the video a title of at most ${PROFILE_VIDEO_TITLE_MAX} characters.`;
const URL_MESSAGE = 'Enter the address of a YouTube or Vimeo video, such as https://www.youtube.com/watch?v=… or https://vimeo.com/….';

/** How many videos this plan shows (0 when it has none). */
export function videoLimit(plan: PlanCode | undefined): number {
  if (plan === undefined) return 0;
  const limit = feature('videos').values[plan].limit;
  return limit === null || limit === undefined ? PROFILE_VIDEOS_MAX : Math.min(limit, PROFILE_VIDEOS_MAX);
}

async function accountLimit(db: Executor, userId: string): Promise<number> {
  const { plan } = await effectivePlan({ kind: 'user', userId }, { db });
  return videoLimit(plan);
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

/** The provider and id of a YouTube or Vimeo video address; null for anything else. */
export function parseVideoUrl(raw: string): { provider: VideoProvider; videoId: string } | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 500 || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (YOUTUBE_HOSTS.has(host)) {
    let id: string | null = null;
    if (host === 'youtu.be') id = parts[0] ?? null;
    else if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') id = parts[1] ?? null;
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', videoId: id } : null;
  }
  if (VIMEO_HOSTS.has(host)) {
    const id = host === 'player.vimeo.com' ? (parts[0] === 'video' ? parts[1] : null) : parts[0];
    return id && VIMEO_ID.test(id) ? { provider: 'vimeo', videoId: id } : null;
  }
  return null;
}

/** The address of the video on its own site (a link the visitor can open in the same tab). */
export function videoPageUrl(provider: VideoProvider, videoId: string): string {
  return provider === 'youtube' ? `https://www.youtube.com/watch?v=${videoId}` : `https://vimeo.com/${videoId}`;
}

export interface ProfileVideo {
  id: string;
  title: string;
  provider: VideoProvider;
  videoId: string;
}

export const profileVideosInput = z.object({
  slug: z
    .string()
    .min(1, { error: 'Must be a profile address.' })
    .max(120, { error: 'Must be a profile address.' })
    .regex(new RegExp(SLUG_PATTERN), { error: 'Must be a profile address.' }),
});

export const setProfileVideosInput = z.object({
  videos: z
    .array(z.object({ title: z.string().max(PROFILE_VIDEO_TITLE_MAX * 4), url: z.string().max(1000) }))
    .max(PROFILE_VIDEOS_MAX, { error: `Add at most ${PROFILE_VIDEOS_MAX} videos.` }),
});

export const removeProfileVideoInput = z.object({ id: z.uuid({ error: NO_VIDEO }), reason: z.string().max(2000) });

const oneLine = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

async function videosOf(db: Executor, personId: string): Promise<ProfileVideo[]> {
  return db
    .select({ id: personVideo.id, title: personVideo.title, provider: personVideo.provider, videoId: personVideo.videoId })
    .from(personVideo)
    .where(eq(personVideo.personId, personId))
    .orderBy(asc(personVideo.position));
}

async function cachedProfileVideos(slug: string): Promise<ProfileVideosDto | null> {
  'use cache';
  cacheLife('minutes');
  const db = getDb();
  const found = await db.execute<{ id: string; user_id: string | null }>(sql`
    SELECT p.id, pe.claimed_by_user_id AS user_id
      FROM v_public_person p
      JOIN person pe ON pe.id = p.id AND pe.deleted_at IS NULL
     WHERE p.slug = ${slug}
     LIMIT 1`);
  const row = found.rows[0];
  if (!row) return null;
  tagCacheEntry([personTag(row.id)]);
  if (!row.user_id) return toPublicProfileVideos({ videos: [] });
  const plans = await effectivePlansOf(db, [row.user_id], new Date());
  const limit = videoLimit(plans.get(row.user_id));
  if (limit === 0) return toPublicProfileVideos({ videos: [] });
  return toPublicProfileVideos({ videos: (await videosOf(db, row.id)).slice(0, limit) });
}

/** people.videos: the videos of a public person, as many as their plan includes; NOT_FOUND for anyone not public. */
export async function profileVideos(_principal: Principal | null, raw: z.input<typeof profileVideosInput>): Promise<ProfileVideosDto> {
  const parsed = profileVideosInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such person.');
  const answer = await cachedProfileVideos(parsed.data.slug);
  if (!answer) throw new ServiceError('NOT_FOUND', 'No such person.');
  return answer;
}

async function ownPersonRow(db: Executor, userId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row ?? null;
}

export interface OwnProfileVideos {
  videos: (ProfileVideo & { url: string })[];
  /** How many the plan shows (0: none; the saved ones are kept). */
  limit: number;
}

/** profile.videos: the account's own videos and its quota. */
export async function myProfileVideos(principal: Principal | null): Promise<OwnProfileVideos> {
  const p = requireUser(principal);
  const db = getDb();
  const own = await ownPersonRow(db, p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
  const videos = (await videosOf(db, own.id)).map((v) => ({ ...v, url: videoPageUrl(v.provider, v.videoId) }));
  return { videos, limit: await accountLimit(db, p.user.id) };
}

/**
 * profile.setVideos: the account's own videos, in the order given, replacing the saved ones; an
 * empty list removes them all. Refused at the plan with ENTITLEMENT_REQUIRED (no videos) or, over
 * the quota, BAD_REQUEST; a field error names the row (`videos.<n>.title` / `videos.<n>.url`).
 */
export async function setProfileVideos(principal: Principal | null, raw: z.input<typeof setProfileVideosInput>, meta: RequestMeta): Promise<{ videos: ProfileVideo[] }> {
  const p = requireUser(principal);
  const parsed = setProfileVideosInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', `Add at most ${PROFILE_VIDEOS_MAX} videos.`, { videos: `Add at most ${PROFILE_VIDEOS_MAX} videos.` });
  const fields: Record<string, string> = {};
  const clean = parsed.data.videos.map((video, i) => {
    const title = oneLine(video.title);
    const found = parseVideoUrl(video.url);
    if (title.length === 0 || title.length > PROFILE_VIDEO_TITLE_MAX) fields[`videos.${i}.title`] = TITLE_MESSAGE;
    if (!found) fields[`videos.${i}.url`] = URL_MESSAGE;
    return { title, provider: found?.provider ?? 'youtube', videoId: found?.videoId ?? '' };
  });
  if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const own = await ownPersonRow(tx, p.user.id);
    if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
    await tx.execute(sql`SELECT 1 FROM person WHERE id = ${own.id}::uuid FOR UPDATE`);
    const limit = await accountLimit(tx, p.user.id);
    if (limit === 0) throw new ServiceError('ENTITLEMENT_REQUIRED', NEEDS_PLAN);
    if (clean.length > limit) {
      const message = `Your plan shows up to ${limit} ${limit === 1 ? 'video' : 'videos'}. Remove one first.`;
      throw new ServiceError('BAD_REQUEST', message, { videos: message });
    }
    const before = await videosOf(tx, own.id);
    const same = before.length === clean.length && before.every((b, i) => b.title === clean[i]!.title && b.provider === clean[i]!.provider && b.videoId === clean[i]!.videoId);
    if (!same) {
      await tx.delete(personVideo).where(eq(personVideo.personId, own.id));
      if (clean.length > 0) await tx.insert(personVideo).values(clean.map((v, position) => ({ personId: own.id, position, title: v.title, provider: v.provider, videoId: v.videoId })));
      await writeAudit(tx, {
        action: 'person.videos',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
        subjectType: 'person',
        subjectId: own.id,
        before: { videos: before.length },
        after: { videos: clean.length },
      });
    }
    return { personId: own.id, changed: !same, videos: await videosOf(tx, own.id) };
  });
  if (result.changed) invalidatePublic([personTag(result.personId)], 'procedure');
  return { videos: result.videos };
}

/** profile.removeVideo: staff with a verified second factor remove one video, with a reason the owner is sent. */
export async function removeProfileVideo(principal: Principal | null, raw: z.input<typeof removeProfileVideoInput>, meta: RequestMeta): Promise<{ id: string; removed: boolean }> {
  const p = requireStaff2FA(principal);
  const parsed = removeProfileVideoInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_VIDEO);
  const reason = parsed.data.reason.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  const message = 'Say why the video is removed: the reason is kept in the audit log and sent to its owner.';
  if (reason.length === 0 || reason.length > 1000) throw new ServiceError('BAD_REQUEST', message, { reason: message });
  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    const [video] = await tx
      .select({ id: personVideo.id, personId: personVideo.personId, owner: person.claimedByUserId })
      .from(personVideo)
      .innerJoin(person, eq(person.id, personVideo.personId))
      .where(eq(personVideo.id, parsed.data.id))
      .for('update');
    if (!video) throw new ServiceError('NOT_FOUND', NO_VIDEO);
    await tx.delete(personVideo).where(eq(personVideo.id, video.id));
    // The rest keep their order without a gap.
    await tx.execute(sql`
      UPDATE person_video v SET position = n.rn - 1, updated_at = now()
        FROM (SELECT id, row_number() OVER (ORDER BY position) AS rn FROM person_video WHERE person_id = ${video.personId}::uuid) n
       WHERE v.id = n.id AND v.position <> n.rn - 1`);
    await writeAudit(tx, {
      action: 'person.video_remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
      subjectType: 'person_video',
      subjectId: video.id,
      before: { personId: video.personId },
      after: null,
      reason,
    });
    if (video.owner && video.owner !== p.user.id) await notify(tx, video.owner, 'content.removed', { content: 'profile_video', reason }, { key: `content.removed:profile_video:${video.id}` });
    return video.personId;
  });
  invalidatePublic([personTag(outcome)], 'procedure');
  return { id: parsed.data.id, removed: true };
}
