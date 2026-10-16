import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { catalogueSeeds, generateKeywordIdeas } from '@/lib/google-ads/keywords'
import { adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  categoryId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).nullable().optional(),
  seeds: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  url: z.string().regex(/^https?:\/\/\S+$/).nullable().optional(),
  language: z.string().regex(/^languageConstants\/\d+$/).optional(),
  locations: z.array(z.string().regex(/^geoTargetConstants\/\d+$/)).max(10).optional(),
})

// Keywords from our catalogue (category, best-selling products, brands) plus Keyword Planner ideas.
// Planner needs Basic or Standard developer-token access; without it the catalogue seeds still come back.
export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse((await readJson(request)) ?? {})
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const b = parsed.data
  try {
    const { seeds, categoryName } = await catalogueSeeds(b.categoryId ?? null)
    const all = [...new Set([...(b.seeds ?? []), ...seeds])]
    let ideas: Awaited<ReturnType<typeof generateKeywordIdeas>> = []
    let ideasError: string | null = null
    try {
      ideas = await generateKeywordIdeas(await googleAdsClientFor(), {
        seeds: all.slice(0, 10),
        url: b.url ?? null,
        language: b.language,
        locations: b.locations,
      })
    } catch (e) {
      ideasError = String((e as any)?.message ?? e).slice(0, 300)
    }
    return NextResponse.json({ seeds: all, categoryName, ideas, ideasError })
  } catch (e) {
    return adsErrorResponse(e)
  }
}
