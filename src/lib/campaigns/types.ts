import type { Campaign, CampaignKind } from '@/lib/marketing'

export type ParamDef =
  | { type: 'integer'; min?: number; max?: number; label: string; description?: string }
  | { type: 'number';  min?: number; max?: number; label: string; description?: string }
  | { type: 'boolean'; label: string; description?: string }

export type ParamSchema<P> = { [K in keyof P]: ParamDef }

export interface ScenarioModule<P extends Record<string, unknown>, Row> {
  readonly kind: CampaignKind
  readonly name: string
  readonly description: string
  readonly trigger: string
  readonly defaultParams: P
  readonly paramSchema: ParamSchema<P>
  findEligible(ctx: { campaign: Campaign; params: P }): Promise<Row[]>
  send(row: Row, ctx: { campaign: Campaign; params: P }): Promise<{ ok: boolean; reason?: string }>
}

export type AnyScenarioModule = ScenarioModule<Record<string, unknown>, unknown>

export interface SweepResult {
  campaign: CampaignKind
  attempted: number
  sent: number
  skipped: number
}

export function resolveParams<P extends Record<string, unknown>>(
  defaults: P,
  override: unknown
): P {
  if (!override || typeof override !== 'object') return { ...defaults }
  const out: Record<string, unknown> = { ...defaults }
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v !== undefined && v !== null) out[k] = v
  }
  return out as P
}
