import type { Campaign, CampaignKind } from '@/lib/shared/marketing'

export type ParamDef =
  | { type: 'integer'; min?: number; max?: number; label: string; description?: string }
  | { type: 'number'; min?: number; max?: number; label: string; description?: string }
  | { type: 'boolean'; label: string; description?: string }

export type ParamSchema<P> = { [K in keyof P]: ParamDef }

export interface SuppressedRow {
  user_id: string | null
  reference_id?: string | null
  reason: 'cooldown' | 'recent_send' | 'opted_out' | 'inactive' | 'other'
  reason_detail?: string | null
  blocked_until?: string | null
  raw?: Record<string, unknown>
}

export interface ScenarioModule<P extends Record<string, unknown>, Row> {
  readonly kind: CampaignKind
  readonly name: string
  readonly description: string
  readonly trigger: string
  readonly defaultParams: P
  readonly paramSchema: ParamSchema<P>
  findEligible(ctx: { campaign: Campaign; params: P }): Promise<Row[]>
  findSuppressed?(ctx: { campaign: Campaign; params: P }): Promise<SuppressedRow[]>
  send(row: Row, ctx: { campaign: Campaign; params: P }): Promise<{ ok: boolean; reason?: string }>
}

export type AnyScenarioModule = ScenarioModule<Record<string, unknown>, unknown>

export interface SweepResult {
  campaign: CampaignKind
  attempted: number
  sent: number
  skipped: number
}

export function resolveParams<P extends Record<string, unknown>>(defaults: P, override: unknown): P {
  if (!override || typeof override !== 'object') return { ...defaults }
  const out: Record<string, unknown> = { ...defaults }
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== 0) out[k] = v
  }
  return out as P
}
