import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { UI_STYLE_IDS } from '@/lib/site/studio/ui-styles'
import { activeRedesign, currentDesign, redesignStatus, type RedesignInput } from '@/lib/site/studio/redesign'
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, siteAiAvailable } from '@/lib/site/ai-status'
import { siteGenerationQuote, SiteGenerationRefused, startSiteGeneration } from '@/lib/site/site-generation'
import { PaidGenerationError } from '@/lib/ai/paid-generation'

export const dynamic = 'force-dynamic'

const Body = z.object({
  // Keep the site's design, or one of the AI Site Studio's UI styles.
  design: z.enum(['keep', ...UI_STYLE_IDS] as [string, ...string[]]).default('keep'),
  reference: z.string().trim().max(500).url().startsWith('https://').nullish(),
  colours: z.enum(['keep', 'new']).default('keep'),
  // The price the owner was shown: a build is charged only once its price was shown (expect: 'paid').
  expect: z.enum(['free', 'paid']).optional(),
  // A stopped build's draft, to carry on with the pages it has not designed.
  resume: z.string().uuid().optional(),
})

// POST: starts the AI redesigning the whole site the AI Site Studio way into a new draft and returns its id at once;
// the build runs in the background (every page, so a while) and records its progress per page, then its charge, on the
// draft. On every plan: a store's first full generation is free, later ones are charged to the AI wallet (402
// wallet_low when it can't hold the cap; 409 price_changed when it wasn't shown as paid; 409 busy while another runs;
// lib/site/site-generation.ts). GET ?draft=: that progress; GET without a draft: whether AI site generation is available
// now (Claude reachable through the gateway; `fresh=1` checks again), what the next build costs, the build running or
// stopped (to pick it up after a refresh) and the design "keep my design" keeps.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Pick a design; a site you like must be a link starting with https://' }, { status: 400 })
  if (!(await siteAiAvailable())) return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
  const { expect: shown, resume, ...input } = parsed.data
  try {
    return NextResponse.json(await startSiteGeneration(input as RedesignInput, admin.adminId, { acceptPaid: shown === 'paid', resume }), { status: 202 })
  } catch (err) {
    if (err instanceof PaidGenerationError || err instanceof SiteGenerationRefused) return NextResponse.json(err.body(), { status: err.status })
    throw err
  }
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = request.nextUrl.searchParams.get('draft') ?? ''
  if (!id) {
    const [available, quote, active, current] = await Promise.all([
      siteAiAvailable(undefined, { fresh: request.nextUrl.searchParams.get('fresh') === '1' }),
      siteGenerationQuote().catch(() => null),
      activeRedesign().catch(() => null),
      currentDesign().catch(() => null),
    ])
    return NextResponse.json({ available, quote, active, current })
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Unknown draft' }, { status: 400 })
  const ai = await redesignStatus(id)
  return ai === undefined ? NextResponse.json({ error: 'Draft not found', code: 'no_draft' }, { status: 404 }) : NextResponse.json({ ai })
}
