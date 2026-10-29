import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/auth/scopes'
import { proxyAdminDocs } from '@/lib/documents/proxy'
import { DOC_FOLDERS, isDocFolder, type DocFolder } from '@/lib/drive/documents'
import { denied, driveActor } from '@/lib/drive/http'
import { GET as cashSaleReceipt } from '@/app/api/(admin)/admin/cash-sale/[id]/receipt/route'
import { GET as packingSlip } from '@/app/api/(admin)/admin/packing-slips/[id]/route'
import { GET as shippingLabel } from '@/app/api/(admin)/admin/orders/[id]/shipping-label/route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A document's PDF for the Drive: inline so it previews, or ?download=1. It calls the route that
// already makes that PDF, which checks its own scope; this only picks the route and the disposition.
export async function GET(request: NextRequest, { params }: { params: Promise<{ folder: string; id: string }> }) {
  const { folder, id } = await params
  const actor = await driveActor(request, 'drive:read')
  if (actor instanceof NextResponse) return actor
  if (!isDocFolder(folder) || !UUID.test(id)) return denied()
  if (!hasScope(actor.role, actor.scopes, DOC_FOLDERS[folder].scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const res = await fetchStored(await render(request, folder, id))
  const disposition = res.headers.get('content-disposition')
  if (res.ok && disposition) {
    const download = request.nextUrl.searchParams.get('download') === '1'
    res.headers.set('content-disposition', disposition.replace(/^\s*(attachment|inline)/i, download ? 'attachment' : 'inline'))
    res.headers.set('cache-control', 'private, no-store')
  }
  return res
}

// The invoice route 302s to the stored PDF on S3, which has no CORS for this origin; read it here so
// the preview gets same-origin bytes. Only our bucket / CDN hosts are followed.
async function fetchStored(res: Response): Promise<Response> {
  const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
  if (!loc || !/^https:\/\//i.test(loc)) return res
  const url = new URL(loc)
  const cdn = process.env.CLOUDFRONT_URL ? new URL(process.env.CLOUDFRONT_URL).hostname : null
  if (!(url.hostname.endsWith('.amazonaws.com') || url.hostname === cdn)) return res
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok || !r.body) return NextResponse.json({ error: 'Document unavailable' }, { status: 502 })
  const name = decodeURIComponent(url.pathname.split('/').pop() || 'document.pdf').replace(/["\\\r\n]/g, '')
  return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'application/pdf', 'content-disposition': `inline; filename="${name}"` } })
}

function render(request: NextRequest, folder: DocFolder, id: string): Promise<Response> {
  const ctx = { params: Promise.resolve({ id }) }
  const internal = (path: string) => new NextRequest(new URL(path, request.url), { headers: request.headers })
  switch (folder) {
    case 'invoices':
      return proxyAdminDocs(request, `/orders/${id}/invoice`, DOC_FOLDERS[folder].scope)
    case 'quotations':
      return proxyAdminDocs(request, `/admin/quotations/${id}/pdf`, DOC_FOLDERS[folder].scope)
    case 'purchase-orders':
      return proxyAdminDocs(request, `/admin/inventory/po/${id}/pdf`, DOC_FOLDERS[folder].scope)
    case 'cash-sales':
      return cashSaleReceipt(internal(`/api/admin/cash-sale/${id}/receipt`), ctx)
    case 'packing-slips':
      return packingSlip(internal(`/api/admin/packing-slips/${id}?inline=1`), ctx)
    case 'shipping-labels':
      return shippingLabel(internal(`/api/admin/orders/${id}/shipping-label?inline=1`), ctx)
  }
}
