import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS } from '@jeffi/site-blocks'
import { requireAdminScope } from '@/lib/auth/jwt'
import { MAX_SOURCE_BYTES } from '@/lib/site/code/allow'
import { checkSection } from '@/lib/site/code/compile'
import { codeLiterals, editCodeLiterals, LiteralEditError } from '@/lib/site/code/literals'

export const dynamic = 'force-dynamic'

const Body = z.object({
  source: z.string().max(MAX_SOURCE_BYTES),
  page: z.enum(PAGE_KEYS),
  edits: z.array(z.object({ id: z.string().max(12), from: z.string().max(4000), to: z.string().max(4000) })).max(50).optional(),
})

// POST { source, page }: a code section's editable words, links and pictures. With `edits`, the source with them written
// in (checked by the compiler) and its new list. Nothing is saved: the editor applies the source as an undoable edit,
// and saving the draft recompiles it.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send { source, page, edits? }' }, { status: 400 })
  const { source, page, edits } = parsed.data
  if (!edits?.length) return NextResponse.json({ literals: codeLiterals(source) })
  let next: string
  try {
    next = editCodeLiterals(source, edits)
  } catch (err) {
    if (err instanceof LiteralEditError) return NextResponse.json({ error: err.message }, { status: 422 })
    throw err
  }
  const r = checkSection(next, { page })
  if (!r.ok) return NextResponse.json({ error: `That change doesn’t fit the section: ${r.issues[0]?.message ?? 'it no longer compiles'}`, issues: r.issues }, { status: 422 })
  return NextResponse.json({ source: next, literals: codeLiterals(next) })
}
