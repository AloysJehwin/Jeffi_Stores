import crypto from 'crypto'
import { z } from 'zod'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { enqueueSocialPost, type ScheduledSocialPost, type SocialPlatform } from '@/lib/tenant-registry'
import { PLATFORM_NETWORK } from './providers/types'

// Compose, edit, cancel, retry and approve for the post queue. Every statement is scoped to the
// caller's store, so an id from another store is simply not found.

export const PLATFORMS = Object.keys(PLATFORM_NETWORK) as SocialPlatform[]

const url = z.string().trim().url().max(2000)

export const ComposeSchema = z.object({
  platforms: z.array(z.enum(PLATFORMS as [SocialPlatform, ...SocialPlatform[]])).min(1).max(8),
  productId: z.string().uuid().nullish(),
  caption: z.string().max(63_000).nullish(),
  hashtags: z.string().max(2000).nullish(),
  title: z.string().max(200).nullish(),
  linkUrl: url.nullish(),
  imageUrl: url.nullish(),
  imageUrls: z.array(url).max(10).nullish(),
  videoUrl: url.nullish(),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  draft: z.boolean().optional(),
  requestApproval: z.boolean().optional(),
})
export type ComposeInput = z.infer<typeof ComposeSchema>

export const EditSchema = ComposeSchema.omit({ platforms: true, productId: true, requestApproval: true }).extend({
  status: z.enum(['draft', 'pending']).optional(),
})

const scoped = (tenantId: string | null, idx: number) => (tenantId ? { sql: `tenant_id = $${idx}`, args: [tenantId] } : { sql: 'tenant_id IS NULL', args: [] })

/** One post per platform, sharing a group id (and so one UTM campaign). */
export async function composePosts(tenantId: string | null, input: ComposeInput, opts: { approval: boolean; createdBy: string | null }): Promise<ScheduledSocialPost[]> {
  const groupId = input.platforms.length > 1 ? crypto.randomUUID() : null
  const out: ScheduledSocialPost[] = []
  for (const platform of [...new Set(input.platforms)]) {
    out.push(
      await enqueueSocialPost({
        tenantId,
        productId: input.productId ?? null,
        platform,
        caption: input.caption ?? null,
        hashtags: input.hashtags ?? null,
        title: input.title ?? null,
        linkUrl: input.linkUrl ?? null,
        imageUrl: input.imageUrl ?? null,
        imageUrls: input.imageUrls ?? null,
        videoUrl: input.videoUrl ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        groupId,
        status: input.draft ? 'draft' : 'pending',
        approvalStatus: opts.approval ? 'pending' : 'none',
        createdBy: opts.createdBy,
      })
    )
  }
  return out
}

export async function getScopedPost(tenantId: string | null, id: string): Promise<ScheduledSocialPost | null> {
  const s = scoped(tenantId, 2)
  const r = await controlPlanePool().query(`SELECT * FROM scheduled_social_posts WHERE id = $1 AND ${s.sql}`, [id, ...s.args])
  return (r.rows[0] as ScheduledSocialPost) ?? null
}

const EDITABLE = ['draft', 'pending', 'failed', 'cancelled']

export async function editPost(tenantId: string | null, id: string, patch: z.infer<typeof EditSchema>): Promise<ScheduledSocialPost | null> {
  const cols: Record<string, unknown> = {
    caption: patch.caption,
    hashtags: patch.hashtags,
    title: patch.title,
    link_url: patch.linkUrl,
    image_url: patch.imageUrl,
    image_urls: patch.imageUrls === undefined ? undefined : patch.imageUrls?.length ? patch.imageUrls : null,
    video_url: patch.videoUrl,
    scheduled_at: patch.scheduledAt,
    status: patch.status,
  }
  const sets: string[] = ['updated_at = now()']
  const args: unknown[] = [id]
  for (const [k, v] of Object.entries(cols)) {
    if (v === undefined) continue
    args.push(v)
    sets.push(`${k} = $${args.length}`)
  }
  const s = scoped(tenantId, args.length + 1)
  const r = await controlPlanePool().query(
    `UPDATE scheduled_social_posts SET ${sets.join(', ')} WHERE id = $1 AND ${s.sql} AND status = ANY($${args.length + 1 + s.args.length}) RETURNING *`,
    [...args, ...s.args, EDITABLE]
  )
  return (r.rows[0] as ScheduledSocialPost) ?? null
}

export async function cancelPost(tenantId: string | null, id: string): Promise<boolean> {
  const s = scoped(tenantId, 2)
  const r = await controlPlanePool().query(
    `UPDATE scheduled_social_posts SET status = 'cancelled', next_attempt_at = NULL, updated_at = now()
     WHERE id = $1 AND ${s.sql} AND status IN ('draft','pending','failed')`,
    [id, ...s.args]
  )
  return (r.rowCount ?? 0) > 0
}

/** A failed or cancelled post back in the queue now, with a fresh set of attempts. */
export async function retryPost(tenantId: string | null, id: string): Promise<boolean> {
  const s = scoped(tenantId, 2)
  const r = await controlPlanePool().query(
    `UPDATE scheduled_social_posts SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = NULL,
       scheduled_at = LEAST(scheduled_at, now()), updated_at = now()
     WHERE id = $1 AND ${s.sql} AND status IN ('failed','cancelled')`,
    [id, ...s.args]
  )
  return (r.rowCount ?? 0) > 0
}

/** Claim one post for "Post now": marks it publishing and counts the attempt, like the cron does. */
export async function claimPostNow(tenantId: string | null, id: string): Promise<ScheduledSocialPost | null> {
  const s = scoped(tenantId, 2)
  const r = await controlPlanePool().query(
    `UPDATE scheduled_social_posts SET status = 'publishing', attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND ${s.sql} AND status IN ('draft','pending','failed') AND approval_status IN ('none','approved') RETURNING *`,
    [id, ...s.args]
  )
  return (r.rows[0] as ScheduledSocialPost) ?? null
}

/** Approve or reject a post and the rest of its group. */
export async function decideApproval(tenantId: string | null, id: string, approve: boolean, by: string | null): Promise<number> {
  const s = scoped(tenantId, 4)
  const r = await controlPlanePool().query(
    `UPDATE scheduled_social_posts SET approval_status = $2, approved_by = $3, approved_at = now(),
       status = CASE WHEN $2 = 'rejected' THEN 'cancelled' ELSE status END, updated_at = now()
     WHERE ${s.sql} AND approval_status = 'pending'
       AND (id = $1 OR group_id = (SELECT group_id FROM scheduled_social_posts WHERE id = $1 AND group_id IS NOT NULL))`,
    [id, approve ? 'approved' : 'rejected', by, ...s.args]
  )
  return r.rowCount ?? 0
}
