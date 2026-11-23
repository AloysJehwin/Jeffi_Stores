import 'server-only'
import { controlPlanePool, getOwnerTenants } from '@/lib/tenant-registry'
import { getWalletBalance, isFlagshipTenant } from '@/lib/payments/wallet'
import { runPaidGeneration } from '@/lib/ai/paid-generation'
import { ensureShowcaseWorkspace } from '@/lib/showcase/workspace'
import { showcaseWalletTenant } from '@controller/lib/showcase/billing'
import { ownerShowcase } from '@controller/lib/showcase-builder/site'
import { WALLET_URL } from '@controller/lib/showcase-builder/build'
import { CORRECTION_PRICE_INR, CORRECTIONS_FREE_PER_DAY } from './allowance'
import { funded } from './funded'
import type { StudioSession } from './sessions'

// AI corrections after the studio site is built (a section changed, a page designed again): CORRECTIONS_FREE_PER_DAY
// free per owner per IST day across their studios (site_studio_corrections), platform-funded; past them each costs
// CORRECTION_PRICE_INR, held on the AI wallet and kept only when the change is saved (runPaidGeneration, flat). The
// client sends the per-correction price it showed; a charge it didn't expect is refused with price_changed.

export interface Correction {
  sessionId: string
  ownerId: string
  /** Free corrections taken from today's allowance (given back when the work fails). */
  free: number
  /** What the wallet is charged when the work succeeds (₹); 0 = free. */
  chargeInr: number
  tenantId: string | null
}

export type CorrectionClaim = { ok: true; correction: Correction } | { ok: false; status: number; error: string; extra: Record<string, unknown> }

/** The runner's result: what fn returned and what the wallet was charged. */
export type CorrectionRun<T> = { result: T; chargedInr: number }

const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Takes up to `units` of the owner's free corrections today; returns how many it took. */
async function takeFree(ownerId: string, units: number): Promise<number> {
  const client = await controlPlanePool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO site_studio_corrections (owner_id, day) VALUES ($1, ${TODAY}) ON CONFLICT DO NOTHING`, [ownerId])
    const r = await client.query<{ used: number }>(`SELECT used FROM site_studio_corrections WHERE owner_id = $1 AND day = ${TODAY} FOR UPDATE`, [ownerId])
    const free = Math.min(units, Math.max(0, CORRECTIONS_FREE_PER_DAY - Number(r.rows[0]?.used ?? 0)))
    if (free) await client.query(`UPDATE site_studio_corrections SET used = used + $2, updated_at = now() WHERE owner_id = $1 AND day = ${TODAY}`, [ownerId, free])
    await client.query('COMMIT')
    return free
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function giveBack(ownerId: string, free: number): Promise<void> {
  if (!free) return
  await controlPlanePool()
    .query(`UPDATE site_studio_corrections SET used = GREATEST(0, used - $2), updated_at = now() WHERE owner_id = $1 AND day = ${TODAY}`, [ownerId, free])
    .catch(err => console.warn('[studio] free correction not given back:', (err as Error).message))
}

/** Whose AI wallet pays: a Showcase's workspace (made on first need, as a redesign does), else the owner's active one. */
async function walletTenant(s: StudioSession): Promise<string | null> {
  if (s.product === 'showcase') {
    const site = await ownerShowcase(s.owner_id)
    if (!site) return null
    return (await showcaseWalletTenant(site)) ?? (await ensureShowcaseWorkspace(site).catch(() => null))
  }
  return (await getOwnerTenants(s.owner_id).catch(() => [])).find(t => t.status === 'active')?.id ?? null
}

/**
 * Claims a correction of `units` (COST): today's free ones first, the rest at CORRECTION_PRICE_INR each. A paid one
 * needs `shownPriceInr` (the per-correction price the owner saw) and a wallet that covers it; otherwise nothing is
 * taken and the refusal says why.
 */
export async function claimCorrection(s: StudioSession, units: number, shownPriceInr: unknown): Promise<CorrectionClaim> {
  const free = await takeFree(s.owner_id, units)
  const paid = units - free
  const chargeInr = paid * CORRECTION_PRICE_INR
  if (!paid) return { ok: true, correction: { sessionId: s.id, ownerId: s.owner_id, free, chargeInr: 0, tenantId: null } }
  const refuse = async (status: number, error: string, extra: Record<string, unknown>): Promise<CorrectionClaim> => {
    await giveBack(s.owner_id, free)
    return { ok: false, status, error, extra: { priceInr: CORRECTION_PRICE_INR, chargeInr, ...extra } }
  }
  const usedUp = free
    ? `Today's free AI changes cover ${free} of the ${units} this counts as.`
    : `You have used today's ${plural(CORRECTIONS_FREE_PER_DAY, 'free AI change')}.`
  const costs = `This change costs ${inr(chargeInr)} from your AI wallet${paid > 1 ? ` (${paid} × ${inr(CORRECTION_PRICE_INR)})` : ''}.`
  if (Number(shownPriceInr) !== CORRECTION_PRICE_INR) return refuse(409, `${usedUp} ${costs}`, { code: 'price_changed' })
  const tenantId = await walletTenant(s)
  if (!tenantId)
    return refuse(402, `${usedUp} More changes cost ${inr(CORRECTION_PRICE_INR)} each from an AI wallet, which you get once your store is approved. Come back tomorrow for ${plural(CORRECTIONS_FREE_PER_DAY, 'more free change')}.`, { code: 'wallet_low', topUpUrl: null })
  if (!isFlagshipTenant(tenantId)) {
    const w = await getWalletBalance(tenantId).catch(() => null)
    if (w && w.balance - chargeInr < w.minBalance) {
      const neededInr = Math.round((chargeInr + w.minBalance - w.balance) * 100) / 100
      return refuse(402, `${usedUp} ${costs} Add ${inr(neededInr)} to your wallet to make it, or come back tomorrow.`, {
        code: 'wallet_low',
        balanceInr: w.balance,
        minBalanceInr: w.minBalance,
        neededInr,
        topUpUrl: WALLET_URL,
      })
    }
  }
  return { ok: true, correction: { sessionId: s.id, ownerId: s.owner_id, free, chargeInr, tenantId } }
}

/** Gives back a claim whose work never started. */
export const releaseCorrection = (c: Correction) => giveBack(c.ownerId, c.free)

/**
 * Runs the correction's AI work (and its save): platform-funded when free, else charged flat to the wallet and
 * refunded if fn throws. Free corrections come back when it fails. A wallet that can no longer hold the charge throws
 * PaidGenerationError before fn runs.
 */
export async function runCorrection<T>(c: Correction, budgetInr: number, label: string, fn: () => Promise<T>): Promise<CorrectionRun<T>> {
  try {
    if (!c.chargeInr || !c.tenantId) return { result: await funded(c.sessionId, budgetInr, fn), chargedInr: 0 }
    const r = await runPaidGeneration(
      { tenantId: c.tenantId, capInr: c.chargeInr, flat: { budgetInr }, ref: `studiofix:${c.sessionId}:${Date.now().toString(36)}`, label, feature: 'site_studio_correction' },
      fn
    )
    return { result: r.result, chargedInr: r.chargedInr }
  } catch (err) {
    await giveBack(c.ownerId, c.free)
    throw err
  }
}
