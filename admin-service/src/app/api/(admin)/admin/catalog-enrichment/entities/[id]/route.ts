import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { approveEntityEnrichment, rejectEntityEnrichment } from '@/lib/catalog/entity-enrichment'

export const dynamic = 'force-dynamic'

/** { action: 'approve', fields?: string[], faqs?: boolean } or { action: 'reject' }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (body.action === 'reject') {
    await rejectEntityEnrichment(id, admin.adminId)
    return NextResponse.json({ ok: true })
  }
  if (body.action !== 'approve') return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  const fields = Array.isArray(body.fields) ? body.fields.filter((f: unknown) => typeof f === 'string') : undefined
  const res = await approveEntityEnrichment(id, { fields, faqs: body.faqs !== false, adminId: admin.adminId })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 })
  revalidatePath('/admin/brands')
  revalidatePath('/admin/categories')
  return NextResponse.json(res)
}
