import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { getOnboardingBuild, startOnboardingBuild, startStudioInstall } from '@/lib/site/onboarding-build'
import { SITE_STYLE_IDS } from '@/lib/site/styles'

export const dynamic = 'force-dynamic'

const Body = z.object({
  description: z.string().trim().min(10).max(2000),
  style: z.enum(['auto', ...SITE_STYLE_IDS]).default('auto'),
  references: z.array(z.string().trim().url().startsWith('https://')).max(3).default([]),
  images: z.boolean().default(true),
  budgetInr: z.number().min(0).max(2000).default(200),
})

// The site the owner made in the AI Site Studio: page docs by `${audience}:${page}` and the chosen theme. Code
// sections are recompiled from their source on install, so compiled ASTs sent here are never trusted. The brief, plan
// and direction are stored with the site (lib/site/studio/context.ts) for Site Builder's AI changes.
const Studio = z.object({
  studio: z.object({
    pages: z.record(z.string(), z.record(z.string(), z.unknown())).refine(p => Object.keys(p).length > 0 && Object.keys(p).length <= 80, 'Between 1 and 80 pages'),
    theme: z.record(z.string(), z.unknown()).nullable().default(null),
    style: z.string().trim().max(80).optional(),
    brief: z.record(z.string(), z.unknown()).nullish(),
    plan: z.record(z.string(), z.unknown()).nullish(),
    direction: z.record(z.string(), z.unknown()).nullish(),
    freeUsed: z.boolean().optional(),
  }),
})

// The controller's build_site provisioning step (CRON_SECRET, the store's Host). POST installs the owner's studio
// site ({ studio }) or starts the store's AI-built first site from a brief on a platform-funded budget, or returns
// the build already running or done; GET reports its progress.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (body && typeof body === 'object' && 'studio' in body) {
    const studio = Studio.safeParse(body)
    if (!studio.success) return NextResponse.json({ error: studio.error.issues[0]?.message ?? 'Invalid studio site' }, { status: 400 })
    return NextResponse.json({ build: await startStudioInstall(studio.data.studio, request) })
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid brief' }, { status: 400 })
  const { budgetInr, ...input } = parsed.data
  return NextResponse.json({ build: await startOnboardingBuild(input, budgetInr, request) })
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ build: await getOnboardingBuild() })
}
