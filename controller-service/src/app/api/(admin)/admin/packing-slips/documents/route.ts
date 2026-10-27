import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import {
  MAX_DOCUMENT_ORDERS,
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

// Several orders' documents as one PDF, grouped per order in the given order.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'packing_slips:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const orderIds = Array.isArray(body.order_ids) ? [...new Set<string>(body.order_ids.map(String))] : []
  if (orderIds.length === 0) return NextResponse.json({ error: 'order_ids required' }, { status: 400 })
  if (orderIds.length > MAX_DOCUMENT_ORDERS)
    return NextResponse.json({ error: `Maximum ${MAX_DOCUMENT_ORDERS} orders per download` }, { status: 400 })
  const docs = parseDocs(body.docs ?? ['packing_slip'])
  if (docs.length === 0) return NextResponse.json({ error: 'Choose at least one document' }, { status: 400 })
  if (missingDocScope(admin, docs)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const result = await buildOrderDocuments({ orderIds, docs, labelSize: parseLabelSize(body.label_size), admin })
    if (!result) return NextResponse.json({ error: 'No orders found' }, { status: 404 })
    return documentsResponse(result, documentsFilename(docs, result.orderNumbers))
  } catch (e: any) {
    if (e instanceof NothingToDownload) return NextResponse.json({ error: e.message }, { status: 422 })
    return NextResponse.json({ error: e?.message || 'Failed to build documents' }, { status: 500 })
  }
}
