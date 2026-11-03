import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { CampaignSpecSchema, FEED_TYPES, IMAGE_AD_TYPES, specProblems } from '@/lib/google-ads/campaign-spec'
import { demandGenMinimumDaily } from '@/lib/google-ads/image-ads'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { createCampaign } from '@/lib/google-ads/campaigns'
import { itemIdsForCategories, type ListingTree } from '@/lib/google-ads/listing'
import { prepareImages } from '@/lib/google-ads/assets'
import { merchantLinkStatus } from '@/lib/google-ads/merchant-link'
import { actorOf, adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'
import { finishJsonDraft } from '@/lib/admin/json-drafts'
import { ADS_CAMPAIGN_DRAFTS } from '@/lib/google-ads/campaign-drafts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// Create a Search, Standard Shopping, Performance Max, Demand Gen or Display campaign from the wizard. preview: true
// only validates it with Google (validateOnly); nothing is created.
export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  const body = (await readJson(request)) as Record<string, unknown> | null
  const parsed = CampaignSpecSchema.safeParse(body?.spec)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: issue ? `${issue.path.join('.') || 'spec'}: ${issue.message}` : 'Invalid campaign' }, { status: 400 })
  }
  const spec = parsed.data
  // The Demand Gen budget minimum is checked once Google's figure for the currency is read.
  const problems = specProblems(spec, undefined, { demandGenMinimum: 0 })
  if (problems.length) return NextResponse.json({ error: problems[0], problems: problems.map(message => ({ message, code: 'INVALID' })) }, { status: 400 })

  try {
    const ads = await googleAdsClientFor()
    if (spec.type === 'DEMAND_GEN') {
      const currency = (await queryOne<{ c: string | null }>(`SELECT currency_code AS c FROM ads_account WHERE id = 1`).catch(() => null))?.c || 'INR'
      const min = await demandGenMinimumDaily(ads, currency)
      const p = specProblems(spec, undefined, { demandGenMinimum: min })
      if (p.length) return NextResponse.json({ error: p[0], problems: p.map(message => ({ message, code: 'INVALID' })) }, { status: 400 })
    }
    let merchantId: string | null = null
    if (FEED_TYPES.includes(spec.type)) {
      const link = await merchantLinkStatus(ads)
      if (!link.merchantId) return NextResponse.json({ error: 'Connect Google Merchant Center for this store first.' }, { status: 409 })
      if (!link.linked) return NextResponse.json({ error: 'Link your Merchant Center account to Google Ads first (Link button above).' }, { status: 409 })
      merchantId = link.merchantId
    }
    let listing: ListingTree | null = null
    if (spec.listing && FEED_TYPES.includes(spec.type)) {
      listing =
        spec.listing.dimension === 'CATEGORY'
          ? { dimension: 'CATEGORY', values: await itemIdsForCategories(spec.listing.values) }
          : { dimension: spec.listing.dimension, values: spec.listing.values }
      if (listing.dimension !== 'ALL' && !listing.values.length) {
        return NextResponse.json({ error: 'None of the chosen categories has products in the feed.' }, { status: 400 })
      }
    }
    const a = spec.assetGroup
    let images: Awaited<ReturnType<typeof prepareImages>> | null = null
    if (spec.type === 'PERFORMANCE_MAX' && a && !a.feedOnly) {
      const { getSiteControls } = await import('@/lib/catalog/site-controls')
      const logo = a.useStoreLogo ? (await getSiteControls()).identity.logoUrl || null : null
      images = await prepareImages(a.imageIds, logo)
      if (!images.logo) return NextResponse.json({ error: 'Add a store logo in Site Controls (or use the product feed only).' }, { status: 400 })
    }
    const ad = spec.imageAd
    if (IMAGE_AD_TYPES.includes(spec.type) && ad) {
      const { getSiteControls } = await import('@/lib/catalog/site-controls')
      const logo = (await getSiteControls()).identity.logoUrl || null
      images = await prepareImages(ad.imageIds, logo, undefined, { portrait: spec.type === 'DEMAND_GEN' })
      if (spec.type === 'DEMAND_GEN' && !images.logo) return NextResponse.json({ error: 'Demand Gen ads need a logo: add a store logo in Site Controls.' }, { status: 400 })
      if (!images.landscape.length) return NextResponse.json({ error: 'None of the chosen product images could be used.' }, { status: 400 })
    }
    const result = await createCampaign(
      spec,
      { customerId: ads.customerId, merchantId, feedLabel: 'IN', images, listing },
      actorOf(admin),
      { client: ads, preview: body?.preview === true }
    )
    // The campaign exists: its wizard draft is done with.
    if (body?.preview !== true && body?.draft_id) {
      await withTransaction(c => finishJsonDraft(c, ADS_CAMPAIGN_DRAFTS, admin, body.draft_id)).catch(err =>
        console.error('[google-ads] campaign draft cleanup failed', err)
      )
    }
    return NextResponse.json({ ok: true, preview: body?.preview === true, ...result })
  } catch (e) {
    return adsErrorResponse(e)
  }
}
