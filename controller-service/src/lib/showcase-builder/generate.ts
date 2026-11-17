import 'server-only'
import type { Owner } from '@/lib/tenant-registry'
import { getWalletBalance } from '@/lib/payments/wallet'
import { SHOWCASE_GENERATION_CAP_INR } from '@/lib/showcase/types'
import { aiUnavailable, fail, sseResponse, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, claimBuild, claimPaidBuild, type StudioSession } from '@controller/lib/site-studio/sessions'
import { allowanceOf } from '@controller/lib/site-studio/allowance'
import { reload } from '@controller/lib/site-studio/build'
import { runShowcaseBuild, runShowcasePaidBuild, WALLET_URL } from './build'
import { ownerShowcase } from './site'
import { showcaseWalletTenant } from '@controller/lib/showcase/billing'
import { ensureShowcaseWorkspace } from '@/lib/showcase/workspace'

// The studio's generate (and "design this page again") for a Showcase. The first generation is free; after it, each
// is charged to the workspace's AI wallet, so the client says it expects to pay (`expect: 'paid'`) after showing the
// price, and a wallet that can't cover the cap gets a 402 (code wallet_low) with where to top it up, before anything
// runs.

const round2 = (n: number) => Math.round(n * 100) / 100

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
    if (!claimed) return fail('Your free generation was just used. Another is charged to your wallet: check the price and try again.', 409, { code: 'price_changed', ...allowanceOf({ ...session, generated_at: new Date().toISOString() }).paid })
    return sseResponse(async send => {
      await runShowcaseBuild(claimed, site, send)
      send('done', studioView(await reload(claimed.id)))
    })
  }

  const price = allowance.paid!
  if (body?.expect !== 'paid') return fail(`Your free generation is used. Another is charged to your wallet: usually ₹${price.lowInr}–₹${price.highInr}, never more than ₹${price.capInr}.`, 409, { code: 'price_changed', ...price })
  // The site's workspace pays, else the owner's active one (as for hosting); a draft with neither gets the workspace
  // its first publish would give it, so its wallet can be topped up.
  const tenantId = (await showcaseWalletTenant(site)) ?? (await ensureShowcaseWorkspace(site).catch(() => null))
  if (!tenantId) return fail('Your free generation is used, and there is no workspace wallet to pay for another yet. Try again in a moment.', 402, { code: 'wallet_low', capInr: SHOWCASE_GENERATION_CAP_INR, topUpUrl: null })
  const wallet = await getWalletBalance(tenantId).catch(() => null)
  if (wallet && wallet.balance - SHOWCASE_GENERATION_CAP_INR < wallet.minBalance) {
    const needed = round2(SHOWCASE_GENERATION_CAP_INR + wallet.minBalance - wallet.balance)
    return fail(`Add ₹${needed} to your wallet: ₹${SHOWCASE_GENERATION_CAP_INR} is held while the AI works, and what it doesn't use comes back.`, 402, {
      code: 'wallet_low',
      balanceInr: wallet.balance,
      neededInr: needed,
      capInr: SHOWCASE_GENERATION_CAP_INR,
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
