import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import {
  NothingToDownload,
  buildOrderDocuments,
  documentsFilename,
  documentsResponse,
  missingDocScope,
  parseDocs,
  parseLabelSize,
} from '@/lib/documents/order-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One order's documents as one PDF: ?docs=invoice,packing_slip,label&label=4x6|a4
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'packing_slips:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const sp = request.nextUrl.searchParams
  const docs = parseDocs(sp.get('docs') || 'packing_slip')
  if (docs.length === 0) return NextResponse.json({ error: 'Choose at least one document' }, { status: 400 })
  if (missingDocScope(admin, docs)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const result = await buildOrderDocuments({ orderIds: [id], docs, labelSize: parseLabelSize(sp.get('label')), admin })
    if (!result) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    return documentsResponse(result, documentsFilename(docs, result.orderNumbers), sp.get('inline') === '1')
  } catch (e: any) {
    if (e instanceof NothingToDownload) return NextResponse.json({ error: e.message }, { status: 422 })
    return NextResponse.json({ error: e?.message || 'Failed to build documents' }, { status: 500 })
  }
}
