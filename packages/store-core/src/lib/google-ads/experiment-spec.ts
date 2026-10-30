import { z } from 'zod'
import { BID_STRATEGIES, STRATEGIES_FOR, type BidStrategy } from './campaign-spec'

// Campaign experiments the console creates (client-safe): a system-managed custom experiment on a
// Search or Display campaign whose trial arm changes the bid strategy or its target. Experiments
// split the base campaign's own budget by traffic, so a budget is not something a trial can
// change; graduating a trial gives it its own budget.

/** Channel types with a system-managed custom experiment, and the experiment type for each. */
export const EXPERIMENT_TYPE_FOR: Record<string, string> = { SEARCH: 'SEARCH_CUSTOM', DISPLAY: 'DISPLAY_CUSTOM' }

export const EXPERIMENT_ACTIONS = ['end', 'promote', 'graduate'] as const
export type ExperimentAction = (typeof EXPERIMENT_ACTIONS)[number]

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const ExperimentSpecSchema = z.object({
  campaignId: z.string().regex(/^\d{1,20}$/, 'Pick a campaign'),
  name: z.string().trim().min(1, 'Name the experiment').max(200),
  description: z.string().trim().max(500).optional(),
  /** Share of traffic for the trial arm, percent. */
  trafficSplit: z.number().int().min(1).max(99),
  startDate: z.string().regex(DATE).nullable().optional(),
  endDate: z.string().regex(DATE).nullable().optional(),
  change: z.object({
    strategy: z.enum(BID_STRATEGIES),
    targetCpa: z.number().positive().max(10_000_000).nullable().optional(),
    targetRoas: z.number().positive().max(1000).nullable().optional(),
  }),
})

export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>

export const ExperimentActionSchema = z.object({
  action: z.enum(EXPERIMENT_ACTIONS),
  /** Graduate only: the daily budget the graduated campaign gets. */
  dailyBudget: z.number().min(1).max(10_000_000).optional(),
  preview: z.boolean().optional(),
})

export interface BaseCampaign {
  channelType: string | null
  biddingStrategyType: string | null
  targetCpa: number | null
  targetRoas: number | null
}

/** Google's strategy types for the strategies the console sets. */
const GOOGLE_TYPE: Record<BidStrategy, string> = {
  MAXIMIZE_CONVERSIONS: 'MAXIMIZE_CONVERSIONS',
  MAXIMIZE_CONVERSION_VALUE: 'MAXIMIZE_CONVERSION_VALUE',
  MANUAL_CPC: 'MANUAL_CPC',
  MAXIMIZE_CLICKS: 'TARGET_SPEND',
}

export function experimentProblems(spec: ExperimentSpec, base: BaseCampaign | null, today = new Date().toISOString().slice(0, 10)): string[] {
  const out: string[] = []
  if (base) {
    const channel = base.channelType ?? ''
    if (!EXPERIMENT_TYPE_FOR[channel]) out.push('Experiments can be created here for Search and Display campaigns')
    else if (!(STRATEGIES_FOR[channel as keyof typeof STRATEGIES_FOR] ?? []).includes(spec.change.strategy)) {
      out.push('That bid strategy is not available for this campaign type')
    }
    const same =
      GOOGLE_TYPE[spec.change.strategy] === base.biddingStrategyType &&
      (spec.change.targetCpa ?? null) === (base.targetCpa ?? null) &&
      (spec.change.targetRoas ?? null) === (base.targetRoas ?? null)
    if (same) out.push('The trial must change something: pick another bid strategy or target')
  }
  if (spec.change.strategy !== 'MAXIMIZE_CONVERSIONS' && spec.change.targetCpa) out.push('Target CPA only applies to Maximise conversions')
  if (spec.change.strategy !== 'MAXIMIZE_CONVERSION_VALUE' && spec.change.targetRoas) out.push('Target ROAS only applies to Maximise conversion value')
  if (spec.startDate && spec.startDate < today) out.push('The start date cannot be in the past')
  if (spec.endDate && spec.endDate <= (spec.startDate || today)) out.push('The end date must be after the start date')
  return out
}

export interface MetricResult {
  key: string
  label: string
  money: boolean
  treatment: number | null
  control: number | null
  /** Treatment minus control, as Google estimates it, with the radius of its confidence interval. */
  estimate: number | null
  margin: number | null
  pValue: number | null
}

/** Google's p-value below this reads as a real difference. */
export const SIGNIFICANCE = 0.05

export const isSignificant = (m: Pick<MetricResult, 'pValue'>) => m.pValue != null && m.pValue < SIGNIFICANCE
