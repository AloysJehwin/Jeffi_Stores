import { NextRequest, NextResponse } from 'next/server'
import { themeAvailability } from '@/lib/site/themes/pages'
import { fail, readJson, studioOwner, studioProductOf, studioSiteOf, studioView } from '@controller/lib/site-studio/http'
import { applyTheme, openThemeStudio } from '@controller/lib/site-studio/themes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Ready-made themes (lib/site/themes), for the store's studio or a Showcase's (?product=showcase). No AI runs here and
// the free generation stays unused, so these work while AI generation is unavailable.
// GET: which styles are ready, with how many pages each brings.
// POST { action: 'open' }: the owner's studio, created on first use (a theme preview needs one).
// POST { action: 'apply', theme: 'minimalist.ocean', replace?: true }: the theme as the whole site; a site already
// there is replaced only with `replace` (else 409, code has_site).
export async function GET(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  return NextResponse.json({ available: themeAvailability(studioProductOf(request)) })
}

export async function POST(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const body = (await readJson(request)) ?? {}
  const opened = await openThemeStudio(owner.id, studioProductOf(request), studioSiteOf(request))
  if (!opened.ok) return fail(opened.error, opened.status, opened.code ? { code: opened.code } : undefined)
  if (body.action === 'open') return NextResponse.json(studioView(opened.session))
  if (body.action !== 'apply') return fail('Unknown action.')
  const applied = await applyTheme(opened.session, body.theme, { replace: body.replace === true })
  if (!applied.ok) return fail(applied.error, applied.status, applied.code ? { code: applied.code } : undefined)
  return NextResponse.json(studioView(applied.session))
}
