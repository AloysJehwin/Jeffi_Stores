import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { parseBody } from '@/lib/shared/validate'
import { KYB_DOCS } from '@controller/lib/kyb/requirements'
import { deleteKybDocument, setOwnerNote } from '@controller/lib/kyb/store'
import { loadKybView } from '@controller/lib/kyb/view'

export const dynamic = 'force-dynamic'

/** The owner explains a document whose check didn't match (a name change, a misread scan): it goes to a reviewer as it is. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ docType: string }> }) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const { docType } = await params
  if (!KYB_DOCS[docType]) return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })
  const parsed = parseBody(z.object({ ownerNote: z.string().trim().min(10, 'Explain in a sentence or two').max(1000).nullable() }), await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const row = await setOwnerNote(ctx.tenant.id, docType, parsed.data.ownerNote)
  if (!row) return NextResponse.json({ error: 'No document of that kind waiting for review' }, { status: 404 })
  return NextResponse.json({ kyb: await loadKybView(ctx.tenant, ctx.owner.id) })
}

/** Removes a KYB document that isn't approved (a registration proof no longer needed). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ docType: string }> }) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const { docType } = await params
  if (!KYB_DOCS[docType]) return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })
  await deleteKybDocument(ctx.tenant.id, docType)
  return NextResponse.json({ kyb: await loadKybView(ctx.tenant, ctx.owner.id) })
}
