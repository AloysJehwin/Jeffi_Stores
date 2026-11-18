import { trueUp } from '@jeffi/wallet'
import { query } from '@/lib/shared/db'
import { controlPlanePool, lookupTenantContextById } from '@/lib/tenant-registry'
import { resolveTenant, runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'
import { isPlatformOwner } from '@/lib/integrations/owner'
import { SHOWCASE_GENERATION_CAP_INR } from '@/lib/showcase/types'
import { runPlatformFunded } from './billing'
import { metered, runMetered } from './cost-meter'
import { noteHoldError, openHold, recordHoldCost, settleHold, staleHolds, type OpenHold, type Settlement } from './generation-holds'

// AI generations the owner pays for: a site's full generations after its free first one. The cap is held on the
// tenant's AI wallet (control plane) before the AI starts, and the hold recorded (./generation-holds.ts); the AI runs
// on a provider-cost budget of cap / margin and stops there, keeping what it built, checkpointing its cost on the hold;
// then the hold is trued-up to provider cost × margin, never above the cap. A hold its run never settled (the process
// died) is settled the same way on the checkpointed cost by sweepStaleHolds. Each AI call is logged at price 0 under
// the generation's wallet_ref and one ai_usage row carries the charge, in the request's store database or, when there
// is none (the ecom console, a services tenant), the platform's. A site's free first generation runs through
// runFreeGeneration on the same meter, paid by the platform.

const round2 = (n: number) => Math.round(n * 100) / 100

/** Provider cost × this is what a generation charges (env AI_REGEN_MARGIN, default 1.5; below 1 is ignored). */
export function aiRegenMargin(): number {
  const m = Number(process.env.AI_REGEN_MARGIN)
  return Number.isFinite(m) && m >= 1 ? m : 1.5
}

/** The most a store's paid whole-site generation charges (env SITE_REGEN_CAP_INR, default ₹1,500: ₹1,000 of AI at the 1.5× margin, enough for every page). */
export function siteRegenCapInr(): number {
  const n = Number(process.env.SITE_REGEN_CAP_INR)
  return Number.isFinite(n) && n > 0 ? n : 1500
}

/** What a generation charges: provider cost × margin to the paisa, never more than the cap. */
export function generationCharge(costInr: number, capInr: number, margin = aiRegenMargin()): number {
  const cost = Number.isFinite(costInr) && costInr > 0 ? costInr : 0
  return Math.min(round2(capInr), round2(cost * margin))
}

export type GenerationKind = 'store_site' | 'one_page'

// Typical provider cost (₹) of one generation at the gateway's prices. A store site is the AI Site Studio pipeline
// (Site Builder's redesign, lib/site/studio/redesign.ts): an Opus brief, plan and direction, the product card and every
// page (about 25, the working pages two sections each) written section by section on Opus with repairs. A build
// measured ₹333 for 11 pages, so ₹450–₹800 for all of them; pictures add up to six draft images. A one-page site: a
// few Opus and Sonnet calls. Only for the UI's range: the charge is what the run cost.
const TYPICAL_COST_INR: Record<GenerationKind, [number, number]> = { store_site: [450, 800], one_page: [10, 40] }
const PICTURES_COST_INR: [number, number] = [2, 40]

/** A typical charge for the UI ("About ₹low–₹high"), in whole rupees, never above the cap. */
export function estimateGeneration(kind: GenerationKind, opts: { images?: boolean; capInr?: number } = {}): { lowInr: number; highInr: number; capInr: number } {
  const capInr = opts.capInr ?? (kind === 'one_page' ? SHOWCASE_GENERATION_CAP_INR : siteRegenCapInr())
  const margin = aiRegenMargin()
  const [lo, hi] = TYPICAL_COST_INR[kind]
  const [plo, phi] = opts.images ? PICTURES_COST_INR : [0, 0]
  const at = (cost: number) => Math.min(capInr, Math.round(cost * margin))
  return { lowInr: at(lo + plo), highInr: at(hi + phi), capInr }
}

/** A paid generation that did not start: the wallet can't hold the cap (402), its ref already ran (409), or the owner
 *  hadn't seen its price, e.g. was shown it as free (409 price_changed: show the price and ask again). */
export class PaidGenerationError extends Error {
  readonly status: 402 | 409
  constructor(
    readonly code: 'wallet_low' | 'duplicate' | 'price_changed',
    message: string,
    readonly balanceInr = 0,
    readonly neededInr = 0,
    readonly capInr = 0
  ) {
    super(message)
    this.name = 'PaidGenerationError'
    this.status = code === 'wallet_low' ? 402 : 409
  }

  /** The JSON a route answers with, at `status`. */
  body() {
    return { error: this.message, code: this.code, balanceInr: this.balanceInr, neededInr: this.neededInr, capInr: this.capInr }
  }
}

export interface PaidGeneration {
  /** Whose AI wallet pays: the store's or the services tenant's id (the flagship never pays). */
  tenantId: string
  /** The most it can charge (₹); this much is held on the wallet while it runs. */
  capInr: number
  /** Unique per generation, at most 58 characters: the ledger entry is aigen:<ref>, and a ref that already ran is refused. */
  ref: string
  /** For the owner: the ledger note is 'AI: <label>'. */
  label: string
  /** ai_usage feature of the charge row (default 'site_generation'). */
  feature?: string
}

export interface PaidGenerationResult<T> {
  /** What the wallet was charged (₹). */
  chargedInr: number
  /** What the AI cost the platform (₹, provider cost as the gateway reports it). */
  costInr: number
  result: T
}

/**
 * Runs `fn` as a generation the owner pays for. Throws PaidGenerationError before anything runs when the wallet can't
 * hold `capInr`. AI calls inside `fn` stop once capInr / margin of provider cost is spent (lib/site/agent.ts and the
 * studio's chat() check the budget). If `fn` throws, the error comes back out after the true-up: nothing spent is
 * refunded in full, otherwise what was spent is charged. Call it from a request without a services tenant's database
 * scope (the ecom console), so each call's usage row lands in the platform's database:
 *
 *   const { chargedInr, result } = await runPaidGeneration(
 *     { tenantId, capInr: SHOWCASE_GENERATION_CAP_INR, ref: `showcase:${site.id}:${site.generations + 1}`, label: 'Showcase site generation', feature: 'showcase_generation' },
 *     () => generateShowcasePage(...)
 *   )
 */
export async function runPaidGeneration<T>(g: PaidGeneration, fn: () => Promise<T>): Promise<PaidGenerationResult<T>> {
  const capInr = round2(g.capInr)
  const walletRef = `aigen:${g.ref}`
  if (!(capInr > 0) || !g.ref || walletRef.length > 64) throw new Error('runPaidGeneration needs a positive capInr and a ref of 1 to 58 characters')
  const margin = aiRegenMargin()
  const note = `AI: ${g.label}`
  const feature = (g.feature ?? 'site_generation').slice(0, 64)
  const pays = !isPlatformOwner(g.tenantId)
  const tenant = pays ? await resolveTenant().catch(() => null) : null
  if (pays) {
    const hold = await openHold({ tenantId: g.tenantId, capInr, walletRef, note, margin, feature, usageDb: tenant?.infra?.rdsEndpoint ? 'store' : 'platform' })
    if (!hold.ok) {
      throw new PaidGenerationError(
        'wallet_low',
        `Your AI wallet needs ₹${hold.needed.toFixed(2)} more: ₹${capInr} is held while the AI works, and what it doesn't use comes back.`,
        hold.balance,
        hold.needed,
        capInr
      )
    }
    if (!hold.charged) throw new PaidGenerationError('duplicate', 'This generation has already run.', hold.balance, 0, capInr)
  }

  let costInr = 0
  let out: { ok: true; result: T } | { ok: false; error: unknown }
  try {
    const result = await runMetered(
      capInr / margin,
      async () => {
        try {
          return await runPlatformFunded(walletRef, Infinity, fn, walletRef)
        } finally {
          costInr = metered()?.costInr ?? 0
        }
      },
      pays ? costCheckpoint(g.tenantId, walletRef) : undefined
    )
    out = { ok: true, result }
  } catch (error) {
    out = { ok: false, error }
  }

  let chargedInr = 0
  if (pays) {
    const s = await settleRun(g.tenantId, walletRef, costInr, capInr, margin, note)
    // A true-up that kept failing leaves the whole hold charged until the sweep settles it: say so.
    chargedInr = s?.chargedInr ?? capInr
    // When the sweep settled it first, the sweep wrote the charge row.
    if (s?.by === 'run' && chargedInr > 0) {
      await recordCharge(tenant, feature, walletRef, g.ref, chargedInr).catch(err => console.warn('[paid-generation] charge row failed:', (err as Error).message))
    }
  }
  if (!out.ok) throw out.error
  return { chargedInr, costInr, result: out.result }
}

/** A site's free first full generation: the platform pays (usage logged as platform:<label>) and the AI stops once
 *  `budgetInr` of provider cost is spent. Returns what it cost the platform. */
export async function runFreeGeneration<T>(label: string, budgetInr: number, fn: () => Promise<T>): Promise<{ costInr: number; result: T }> {
  let costInr = 0
  const result = await runMetered(budgetInr, async () => {
    try {
      return await runPlatformFunded(label, Infinity, fn)
    } finally {
      costInr = metered()?.costInr ?? 0
    }
  })
  return { costInr, result }
}

const chargeOf = (t: { costInr: number; capInr: number; margin: number }) => generationCharge(t.costInr, t.capInr, t.margin)

// Settles the run's own hold, retrying briefly; null when it could not (the hold stands until the sweep settles it).
async function settleRun(tenantId: string, walletRef: string, costInr: number, capInr: number, margin: number, note: string): Promise<Settlement | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const s = await settleHold(tenantId, walletRef, 'run', chargeOf, costInr)
      if (s) return s
      // No hold recorded: true the debit up directly.
      const chargedInr = generationCharge(costInr, capInr, margin)
      await trueUp({ tenantId, amountInr: chargedInr, externalRef: walletRef, note })
      return { chargedInr, costInr, by: 'run', now: true }
    } catch (err) {
      if (attempt === 3) {
        console.error(`[paid-generation] true-up failed: ${walletRef} of tenant ${tenantId} stays held at ₹${capInr} until the ai_hold_sweep cron settles it`, (err as Error).message)
        // So the sweep charges the whole run, not its last checkpoint.
        await recordHoldCost(tenantId, walletRef, costInr).catch(() => {})
        return null
      }
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  return null
}

// Writes the run's provider cost to its hold as it grows: one write at a time, the latest total winning.
function costCheckpoint(tenantId: string, walletRef: string): (costInr: number) => void {
  let latest = 0
  let writing = false
  return costInr => {
    latest = costInr
    if (writing) return
    writing = true
    void (async () => {
      for (let written = 0; written < latest; ) {
        written = latest
        await recordHoldCost(tenantId, walletRef, written).catch(err => console.warn('[paid-generation] cost checkpoint failed:', (err as Error).message))
      }
      writing = false
    })()
  }
}

const CHARGE_SQL = `INSERT INTO ai_usage (feature, capability, provider, model, cost_inr, price_inr, wallet_ref, status, ref)
                    VALUES ($1, 'text', 'platform', 'generation', 0, $2, $3, 'ok', $4)`

// The charge as one ai_usage row (each call was logged at price 0). A services tenant's context has no database of its
// own, so its row goes to the platform's; otherwise the request's (a store's, or the platform's with no tenant).
async function recordCharge(tenant: TenantContext | null, feature: string, walletRef: string, ref: string, chargedInr: number): Promise<void> {
  const params = [feature, chargedInr, walletRef, ref.slice(0, 128)]
  if (tenant && !tenant.infra?.rdsEndpoint) await controlPlanePool().query(CHARGE_SQL, params)
  else await query(CHARGE_SQL, params)
}

// The sweep's charge row, in the database its run logged the calls in.
async function sweepChargeRow(h: OpenHold, chargedInr: number): Promise<void> {
  const params = [h.feature, chargedInr, h.walletRef, h.walletRef.slice('aigen:'.length, 'aigen:'.length + 128)]
  if (h.usageDb === 'platform') {
    await controlPlanePool().query(CHARGE_SQL, params)
    return
  }
  const ctx = await lookupTenantContextById(h.tenantId)
  if (!ctx) throw new Error(`no tenant ${h.tenantId}`)
  await runWithTenantContext(ctx, () => query(CHARGE_SQL, params))
}

/** How long a hold stays open before the sweep settles it: far longer than any run. */
export const STALE_HOLD_MS = 2 * 60 * 60 * 1000

export interface HoldSweep {
  settled: { tenantId: string; walletRef: string; costInr: number; chargedInr: number; refundedInr: number }[]
  failed: { tenantId: string; walletRef: string; capInr: number; error: string; firstFailure: boolean }[]
}

/**
 * Settles paid-generation holds still open STALE_HOLD_MS after they were taken (their run's process died): charges the
 * provider cost the run checkpointed × the hold's margin, never above the cap, refunds the rest and writes the charge
 * row. A hold its run settles meanwhile is left alone. The controller's ai_hold_sweep cron, every 15 min.
 */
export async function sweepStaleHolds(olderThanMs = STALE_HOLD_MS): Promise<HoldSweep> {
  const out: HoldSweep = { settled: [], failed: [] }
  for (const h of await staleHolds(olderThanMs)) {
    try {
      const s = await settleHold(h.tenantId, h.walletRef, 'sweep', chargeOf)
      if (!s?.now) continue
      out.settled.push({ tenantId: h.tenantId, walletRef: h.walletRef, costInr: s.costInr, chargedInr: s.chargedInr, refundedInr: round2(h.capInr - s.chargedInr) })
      if (s.chargedInr > 0) {
        await sweepChargeRow(h, s.chargedInr).catch(err => console.error(`[ai-hold-sweep] ${h.walletRef} settled at ₹${s.chargedInr}; its charge row failed:`, (err as Error).message))
      }
    } catch (err) {
      const error = (err as Error)?.message || String(err)
      console.error(`[ai-hold-sweep] could not settle ${h.walletRef} of tenant ${h.tenantId}; ₹${h.capInr} stays held:`, error)
      out.failed.push({ tenantId: h.tenantId, walletRef: h.walletRef, capInr: h.capInr, error, firstFailure: !h.lastError })
      await noteHoldError(h.tenantId, h.walletRef, error).catch(() => {})
    }
  }
  return out
}
