import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, SITE_AUDIENCES, SITE_SURFACES, normalizeDoc, normalizeTheme, type PageDoc } from '@jeffi/site-blocks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { critiquePage, fixPage } from '@/lib/site/critique'
import { getPublishedTheme } from '@/lib/site/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  ref: z.object({
    audience: z.enum(SITE_AUDIENCES as [string, ...string[]]),
    surface: z.enum(SITE_SURFACES as [string, ...string[]]),
    page: z.enum(PAGE_KEYS),
  }),
  doc: z.object({ blocks: z.record(z.string(), z.unknown()), order: z.array(z.string()) }).passthrough(),
  theme: z.record(z.string(), z.unknown()).nullish(),
  fix: z.boolean().default(false),
})

// POST: the critique pass on the page being edited: what would look broken or empty to customers, and with `fix`, the
// page (and theme) with everything fixable fixed. Nothing is saved; the editor applies the result as an undoable edit.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send the page to check' }, { status: 400 })
  const ref = parsed.data.ref as never
  const doc = normalizeDoc(parsed.data.doc as unknown as PageDoc)
  const theme = normalizeTheme((parsed.data.theme as never) ?? (await getPublishedTheme(parsed.data.ref.audience as never)) ?? {})
  const findings = await critiquePage(doc, ref, theme)
  if (!parsed.data.fix) return NextResponse.json({ findings })
  const r = await fixPage(doc, findings, theme)
  const left = r.fixed ? await critiquePage(r.doc, ref, r.theme ?? theme) : findings
  return NextResponse.json({ findings: left, fixed: r.fixed, doc: r.fixed ? r.doc : null, theme: r.theme })
}
