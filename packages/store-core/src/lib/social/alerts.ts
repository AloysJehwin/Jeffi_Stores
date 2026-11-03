import { z } from 'zod'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
import type { Finding, RuleSet } from '@/lib/channels/alerts-engine'
import { listAccounts } from './accounts'
import { NETWORK_LABEL } from './oauth'
import type { Network } from './providers/types'

// Social alert rules, run after the insights job: failed posts, connections about to expire or
// waiting for a target, posts waiting for approval and comments or reviews left unanswered.

const num = (min: number, max: number) => z.number().min(min).max(max)

const schema = z.object({
  failed_posts: z.object({ enabled: z.boolean() }),
  token_expiry: z.object({ enabled: z.boolean(), days: num(1, 30) }),
  needs_target: z.object({ enabled: z.boolean() }),
  approval_waiting: z.object({ enabled: z.boolean(), hours: num(1, 168) }),
  unanswered: z.object({ enabled: z.boolean(), hours: num(1, 168) }),
})
export type SocialAlertConfig = z.infer<typeof schema>

export const SOCIAL_DEFAULTS: SocialAlertConfig = {
  failed_posts: { enabled: true },
  token_expiry: { enabled: true, days: 7 },
  needs_target: { enabled: true },
  approval_waiting: { enabled: true, hours: 24 },
  unanswered: { enabled: true, hours: 24 },
}

export interface SocialSnapshot {
  failed: { id: string; platform: string; error: string | null }[]
  accounts: { provider: Network; status: string; expiresAt: string | null; hasRefresh: boolean }[]
  approvalWaiting: number
  unanswered: { network: string; n: number }[]
}

export function evaluateSocial(s: SocialSnapshot, cfg: SocialAlertConfig, now = new Date()): Finding[] {
  const out: Finding[] = []
  if (cfg.failed_posts.enabled) {
    for (const p of s.failed) {
      out.push({
        rule: 'failed_posts',
        key: `failed_posts:${p.id}`,
        severity: 'warning',
        title: `A ${p.platform} post failed to publish`,
        message: p.error ?? 'Publishing failed after 5 attempts.',
        entityType: 'social_post',
        entityId: p.id,
      })
    }
  }
  for (const a of s.accounts) {
    const label = NETWORK_LABEL[a.provider] ?? a.provider
    if (cfg.needs_target.enabled && a.status === 'pending') {
      out.push({ rule: 'needs_target', key: `needs_target:${a.provider}`, severity: 'warning', title: `${label}: choose where to post`, message: 'Signed in, but no page, board or channel has been chosen yet.' })
    }
    // Tokens that refresh themselves are not a problem; long-lived ones (Meta Page tokens) are.
    if (cfg.token_expiry.enabled && a.expiresAt && !a.hasRefresh) {
      const days = (new Date(a.expiresAt).getTime() - now.getTime()) / 86_400_000
      if (days < cfg.token_expiry.days) {
        out.push({
          rule: 'token_expiry',
          key: `token_expiry:${a.provider}`,
          severity: days < 0 ? 'critical' : 'warning',
          title: days < 0 ? `${label} connection expired` : `${label} connection expires in ${Math.max(0, Math.ceil(days))} days`,
          message: 'Reconnect it so scheduled posts keep publishing.',
        })
      }
    }
  }
  if (cfg.approval_waiting.enabled && s.approvalWaiting > 0) {
    out.push({
      rule: 'approval_waiting',
      key: 'approval_waiting',
      severity: 'info',
      title: `${s.approvalWaiting} post${s.approvalWaiting === 1 ? '' : 's'} waiting for approval`,
      message: `Waiting more than ${cfg.approval_waiting.hours} hours.`,
    })
  }
  if (cfg.unanswered.enabled) {
    for (const u of s.unanswered) {
      out.push({
        rule: 'unanswered',
        key: `unanswered:${u.network}`,
        severity: 'info',
        title: `${u.n} unanswered on ${NETWORK_LABEL[u.network as Network] ?? u.network}`,
        message: `Comments or reviews older than ${cfg.unanswered.hours} hours with no reply.`,
      })
    }
  }
  return out
}

async function loadSnapshot(cfg: SocialAlertConfig): Promise<SocialSnapshot> {
  const tenantId = getCurrentTenantId()
  const pool = controlPlanePool()
  const where = tenantId ? 'tenant_id = $1' : 'tenant_id IS NULL'
  const args = tenantId ? [tenantId] : []
  const [failed, approval, unanswered, accounts] = await Promise.all([
    pool.query(`SELECT id, platform, last_error FROM scheduled_social_posts WHERE ${where} AND status = 'failed' AND updated_at > now() - interval '3 days' LIMIT 30`, args),
    pool.query(
      `SELECT count(*) AS n FROM scheduled_social_posts WHERE ${where} AND approval_status = 'pending' AND status IN ('pending','draft')
         AND created_at < now() - make_interval(hours => ${Number(cfg.approval_waiting.hours)})`,
      args
    ),
    pool.query(
      `SELECT network, count(*) AS n FROM social_inbox WHERE ${where} AND replied_at IS NULL
         AND created_at < now() - make_interval(hours => ${Number(cfg.unanswered.hours)}) AND created_at > now() - interval '14 days' GROUP BY network`,
      args
    ),
    listAccounts(tenantId),
  ])
  const { decryptToken } = await import('@/lib/crypto/token-cipher')
  return {
    failed: failed.rows.map((r: any) => ({ id: r.id, platform: r.platform, error: r.last_error })),
    approvalWaiting: Number(approval.rows[0]?.n ?? 0),
    unanswered: unanswered.rows.map((r: any) => ({ network: r.network, n: Number(r.n) })),
    accounts: accounts.map(a => {
      let hasRefresh = false
      try {
        hasRefresh = !!JSON.parse(decryptToken(a.access_token_enc))?.refreshToken
      } catch {}
      return { provider: a.provider, status: a.status, expiresAt: a.token_expiry, hasRefresh }
    }),
  }
}

export const SOCIAL_RULES: RuleSet<SocialAlertConfig, SocialSnapshot> = {
  channel: 'social',
  schema: schema as any,
  defaults: SOCIAL_DEFAULTS,
  labels: {
    failed_posts: 'Posts that failed to publish',
    token_expiry: 'Connection about to expire',
    needs_target: 'Connection waiting for a page or board',
    approval_waiting: 'Posts waiting for approval',
    unanswered: 'Comments and reviews without a reply',
  },
  loadSnapshot: cfg => loadSnapshot(cfg),
  evaluate: (s, cfg) => evaluateSocial(s, cfg),
}
