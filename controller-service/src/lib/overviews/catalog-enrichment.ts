import type { AttentionItem } from '@/lib/overview/attention'
import { inIst, num } from './catalog'

// AI catalogue enrichment: proposals (product_ai_enrichment_log) and the AI fields filled on
// active products. Params: $1/$2 current IST days, $3/$4 previous.

export const AI_FIELDS = [
  'ai_description',
  'ai_use_cases',
  'ai_keywords',
  'ai_who_uses_it',
  'ai_application',
  'ai_product_type',
  'ai_features',
  'ai_search_tags',
] as const

const filled = (f: string) =>
  f === 'ai_use_cases' || f === 'ai_keywords' || f === 'ai_features' || f === 'ai_search_tags'
    ? `(COALESCE(cardinality(p.${f}), 0) > 0)`
    : `(NULLIF(btrim(COALESCE(p.${f}, '')), '') IS NOT NULL)`

export const STALE_DAYS = 7

export const ENRICHMENT_PERIOD_SQL = `
  WITH per AS (SELECT unnest(ARRAY[true, false]) AS cur)
  SELECT per.cur,
    (SELECT COUNT(*) FROM product_ai_enrichment_log l WHERE CASE WHEN per.cur THEN ${inIst('l.proposed_at', 1, 2)} ELSE ${inIst('l.proposed_at', 3, 4)} END) AS proposed,
    (SELECT COUNT(DISTINCT l.product_id) FROM product_ai_enrichment_log l WHERE CASE WHEN per.cur THEN ${inIst('l.proposed_at', 1, 2)} ELSE ${inIst('l.proposed_at', 3, 4)} END) AS products,
    (SELECT COUNT(*) FROM product_ai_enrichment_log l WHERE l.status = 'failed' AND CASE WHEN per.cur THEN ${inIst('l.proposed_at', 1, 2)} ELSE ${inIst('l.proposed_at', 3, 4)} END) AS failed,
    (SELECT COALESCE(SUM(COALESCE(l.prompt_tokens, 0) + COALESCE(l.completion_tokens, 0)), 0) FROM product_ai_enrichment_log l WHERE CASE WHEN per.cur THEN ${inIst('l.proposed_at', 1, 2)} ELSE ${inIst('l.proposed_at', 3, 4)} END) AS tokens,
    (SELECT COUNT(*) FROM product_ai_enrichment_log l WHERE l.status = 'approved' AND CASE WHEN per.cur THEN ${inIst('l.decided_at', 1, 2)} ELSE ${inIst('l.decided_at', 3, 4)} END) AS approved,
    (SELECT COUNT(*) FROM product_ai_enrichment_log l WHERE l.status = 'rejected' AND CASE WHEN per.cur THEN ${inIst('l.decided_at', 1, 2)} ELSE ${inIst('l.decided_at', 3, 4)} END) AS rejected
  FROM per`

export const ENRICHMENT_STATE_SQL = `
  SELECT
    (SELECT COUNT(*) FROM product_ai_enrichment_log WHERE status = 'proposed') AS pending,
    (SELECT COUNT(*) FROM product_ai_enrichment_log WHERE status = 'proposed' AND proposed_at < now() - INTERVAL '${STALE_DAYS} days') AS pending_stale,
    (SELECT MIN(proposed_at) FROM product_ai_enrichment_log WHERE status = 'proposed') AS oldest_pending,
    (SELECT COUNT(*) FROM product_ai_enrichment_log WHERE promoted_at IS NOT NULL AND re_embedded_at IS NULL) AS not_reindexed,
    COUNT(*) AS active,
    COUNT(*) FILTER (WHERE p.ai_enriched_at IS NOT NULL) AS enriched,
    ${AI_FIELDS.map(f => `COUNT(*) FILTER (WHERE ${filled(f)}) AS ${f}`).join(',\n    ')}
  FROM products p
  WHERE p.is_active AND NOT p.is_draft`

export interface EnrichmentState {
  pending: number
  pendingStale: number
  oldestPending: string | null
  notReindexed: number
  active: number
  enriched: number
  fields: Record<(typeof AI_FIELDS)[number], number>
  /** Average share of the AI fields filled across active products. */
  fieldsFilled: number | null
}

export function enrichmentState(r: Record<string, unknown> | null | undefined): EnrichmentState {
  const active = num(r?.active)
  const fields = Object.fromEntries(AI_FIELDS.map(f => [f, num(r?.[f])])) as EnrichmentState['fields']
  const sum = AI_FIELDS.reduce((a, f) => a + fields[f], 0)
  const oldest = r?.oldest_pending
  return {
    pending: num(r?.pending),
    pendingStale: num(r?.pending_stale),
    oldestPending: oldest == null ? null : oldest instanceof Date ? oldest.toISOString() : String(oldest),
    notReindexed: num(r?.not_reindexed),
    active,
    enriched: num(r?.enriched),
    fields,
    fieldsFilled: active ? sum / (active * AI_FIELDS.length) : null,
  }
}

export const approvalRate = (approved: number, rejected: number) =>
  approved + rejected ? approved / (approved + rejected) : null

export function enrichmentAttention(s: EnrichmentState, failedInPeriod: number): AttentionItem[] {
  const out: AttentionItem[] = []
  const href = '/admin/catalog-enrichment'
  if (s.pendingStale)
    out.push({
      key: 'stale',
      severity: 'warning',
      title: `${s.pendingStale} suggestion${s.pendingStale === 1 ? '' : 's'} waiting over ${STALE_DAYS} days`,
      sub: `${s.pending} pending in total`,
      href,
    })
  else if (s.pending)
    out.push({
      key: 'pending',
      severity: 'info',
      title: `${s.pending} suggestion${s.pending === 1 ? '' : 's'} waiting for review`,
      href,
    })
  if (failedInPeriod)
    out.push({
      key: 'failed',
      severity: 'warning',
      title: `${failedInPeriod} enrichment run${failedInPeriod === 1 ? '' : 's'} failed this period`,
      href,
    })
  const missing = s.active - s.enriched
  if (missing > 0)
    out.push({
      key: 'not_enriched',
      severity: 'info',
      title: `${missing.toLocaleString('en-IN')} active product${missing === 1 ? '' : 's'} never enriched`,
      sub: 'They rank lower in site search',
      href,
    })
  if (s.notReindexed)
    out.push({
      key: 'reindex',
      severity: 'info',
      title: `${s.notReindexed} approved suggestion${s.notReindexed === 1 ? '' : 's'} not yet re-indexed for search`,
    })
  return out
}
