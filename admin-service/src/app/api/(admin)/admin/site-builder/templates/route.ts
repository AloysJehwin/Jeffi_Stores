import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, SITE_AUDIENCES, SITE_SURFACES } from '@jeffi/site-blocks'
import { requireAdminScope } from '@/lib/auth/jwt'
import { builtInTemplates, deleteTemplate, saveTemplate, savedTemplates } from '@/lib/site/templates'
import { themeAvailability } from '@/lib/site/themes/pages'

export const dynamic = 'force-dynamic'

// GET: built-in templates and the ones this store saved, and the ready-made themes whose pages are ready (lib/site/themes;
// applied through drafts/[id]/pack). POST: "save as my template". DELETE ?id=: remove a saved one.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ builtIn: builtInTemplates(), saved: await savedTemplates(), themes: themeAvailability('store') })
}

const Page = z.object({
  audience: z.enum(SITE_AUDIENCES as [string, ...string[]]),
  surface: z.enum(SITE_SURFACES as [string, ...string[]]),
  page: z.enum(PAGE_KEYS),
  doc: z.object({ blocks: z.record(z.string(), z.unknown()), order: z.array(z.string()) }).passthrough(),
})
const Body = z
  .object({ name: z.string().trim().min(2).max(120), description: z.string().max(500).nullish(), kind: z.literal('block').optional(), pages: z.array(Page).min(1).max(40) })
  .refine(b => b.kind !== 'block' || (b.pages.length === 1 && b.pages[0].doc.order.length === 1), 'A saved block is one block')

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Name the template (2–120 characters) and include at least one page' }, { status: 400 })
  return NextResponse.json({ id: await saveTemplate(parsed.data as never, admin.adminId) })
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Built-in templates cannot be deleted' }, { status: 400 })
  return (await deleteTemplate(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Template not found' }, { status: 404 })
}
