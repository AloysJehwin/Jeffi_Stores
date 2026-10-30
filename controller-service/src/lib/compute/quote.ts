import 'server-only'
import { vcpuCapacityError } from '@controller/lib/k8s/capacity'
import { monthlyTotal, quoteSpec, UnknownPriceError, type Quote } from './pricing'
import { presetOf } from '@/lib/compute/presets'
import { validateSpec, type Validation } from '@/lib/compute/validate'
import type { Catalog, ComputeSpec, PlanCompute } from '@/lib/compute/spec'
import type { PlanOption } from './catalog'

export interface PlanQuote {
  preset: ReturnType<typeof presetOf>
  validation: Validation
  quote: Quote | null
  total: ReturnType<typeof monthlyTotal> | null
  capacityError: string | null
}

/** Server-side price and checks for a spec on a plan. The client's own quote is display only. */
// `extraVcpus`: what the change adds to the account's running servers (a resize); default all of them.
export async function quoteForPlan(
  spec: ComputeSpec,
  plan: PlanOption | PlanCompute,
  catalog: Catalog,
  opts: { current?: ComputeSpec | null; anyPlan?: boolean; extraVcpus?: number } = {}
): Promise<PlanQuote> {
  const validation = validateSpec(spec, catalog, plan, opts)
  let quote: Quote | null = null
  try {
    quote = quoteSpec(spec, catalog)
  } catch (e) {
    if (!(e instanceof UnknownPriceError)) throw e
    validation.ok = false
    validation.errors.push(e.message)
  }
  const fee = 'monthlyPriceInr' in plan ? plan.monthlyPriceInr : 0
  return {
    preset: presetOf(spec),
    validation,
    quote,
    total: quote ? monthlyTotal(quote, fee, catalog.settings.gstRate) : null,
    capacityError: validation.ok && validation.fit ? await vcpuCapacityError(opts.extraVcpus ?? validation.fit.vcpus) : null,
  }
}
