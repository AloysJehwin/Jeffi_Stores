import 'server-only'
import type { Owner } from '@/lib/tenant-registry'
import { getWalletBalance, isFlagshipTenant } from '@/lib/payments/wallet'
import { SHOWCASE_REDESIGN_PRICE_INR } from '@/lib/showcase/types'
import { aiUnavailable, fail, sseResponse, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, claimBuild, claimPaidBuild, type StudioSession } from '@controller/lib/site-studio/sessions'
import { allowanceOf } from '@controller/lib/site-studio/allowance'
import { reload } from '@controller/lib/site-studio/build'
import { runShowcaseBuild, runShowcasePaidBuild, WALLET_URL } from './build'
import { ownerShowcase } from './site'
import { showcaseWalletTenant } from '@controller/lib/showcase/billing'
import { ensureShowcaseWorkspace } from '@/lib/showcase/workspace'

// The studio's generate (and "design this page again") for a Showcase. The first generation is free; after it, each is
// a redesign for SHOWCASE_REDESIGN_PRICE_INR from the workspace's wallet, so the client says it expects to pay
// (`expect: 'paid'`, with the `priceInr` it showed), and a wallet that can't cover the price gets a 402 (code
// wallet_low) with what to add and where, before anything runs.

const round2 = (n: number) => Math.round(n * 100) / 100
const inr = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** What a wallet short of a redesign must add. Like every wallet charge, the redesign leaves the wallet's minimum
 *  balance (set per workspace, ₹0 unless an admin set one) in place. */
export function redesignShortfall(balanceInr: number, minBalanceInr: number, priceInr = SHOWCASE_REDESIGN_PRICE_INR) {
  const neededInr = round2(priceInr + minBalanceInr - balanceInr)
  const keeps = minBalanceInr > 0 ? `, and keeps ${inr(minBalanceInr)} as its minimum balance` : ''
  return { neededInr, message: `Add ${inr(neededInr)} to your wallet to design your page again. A redesign costs ${inr(priceInr)}; your wallet has ${inr(balanceInr)}${keeps}.` }
}

export async function showcaseGenerate(owner: Owner, session: StudioSession, body: Record<string, unknown> | null): Promise<Response> {
  if (!session.direction) return fail('Choose a design direction first.', 409)
  const site = await ownerShowcase(owner.id)
  if (!site) return fail('Save your business details first.', 409)
  const allowance = allowanceOf(session)
  if (buildRunning(session)) return fail('Your page is already being designed.', 409, { code: 'running' })
  const down = await aiUnavailable()
  if (down) return down

  if (allowance.free !== 'used') {
    const claimed = await claimBuild(session.id)
    if (!claimed) return fail(`Your free design was just used. Designing your page again costs ${inr(SHOWCASE_REDESIGN_PRICE_INR)} from your wallet.`, 409, { code: 'price_changed', priceInr: SHOWCASE_REDESIGN_PRICE_INR })
    return sseResponse(async send => {
      await runShowcaseBuild(claimed, site, send)
      send('done', studioView(await reload(claimed.id)))
    })
  }

  const priceInr = SHOWCASE_REDESIGN_PRICE_INR
  // A client that sends no price confirmed the older "never more than ₹100", which covers it.
  const shown = body?.priceInr
  if (body?.expect !== 'paid' || (shown !== undefined && Number(shown) !== priceInr)) {
    return fail(`Your free design is used. Designing your page again costs ${inr(priceInr)} from your wallet.`, 409, { code: 'price_changed', priceInr })
  }
  // The site's workspace pays, else the owner's active one (as for hosting); a draft with neither gets the workspace
  // its first publish would give it, so its wallet can be topped up.
  const tenantId = (await showcaseWalletTenant(site)) ?? (await ensureShowcaseWorkspace(site).catch(() => null))
  if (!tenantId) return fail(`A redesign costs ${inr(priceInr)} from your workspace's wallet, and your workspace isn't ready yet. Try again in a moment.`, 402, { code: 'wallet_low', priceInr, topUpUrl: null })
  const wallet = isFlagshipTenant(tenantId) ? null : await getWalletBalance(tenantId).catch(() => null)
  if (wallet && wallet.balance - priceInr < wallet.minBalance) {
    const short = redesignShortfall(wallet.balance, wallet.minBalance, priceInr)
    return fail(short.message, 402, {
      code: 'wallet_low',
      balanceInr: wallet.balance,
      minBalanceInr: wallet.minBalance,
      neededInr: short.neededInr,
      priceInr,
      topUpUrl: WALLET_URL,
    })
  }
  const claimed = await claimPaidBuild(session.id)
  if (!claimed) return fail('Your page is busy. Try again in a moment.', 409, { code: 'running' })
  return sseResponse(async send => {
    await runShowcasePaidBuild(claimed, { ...site, tenantId }, send)
    send('done', studioView(await reload(claimed.id)))
  })
}
