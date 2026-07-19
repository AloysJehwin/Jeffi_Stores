import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getBrochureProductsByIds } from '@/lib/queries'
import { generateBrochurePDF, loadBrochureStore } from '@/lib/brochure-pdf'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Generates the catalogue brochure PDF from the admin's final product selection.
 * Body: { productIds: string[], showPrices: boolean, title?: string }. The ids
 * are the products left checked in the popup (section 2).
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'products:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const productIds: unknown = body.productIds
    const showPrices = body.showPrices === true
    const title = typeof body.title === 'string' ? body.title.slice(0, 120) : undefined

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one product' }, { status: 400 })
    }

    const ids = productIds.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Invalid product selection' }, { status: 400 })
    }

    const products = await getBrochureProductsByIds(ids)
    if (products.length === 0) {
      return NextResponse.json({ error: 'No matching products found' }, { status: 404 })
    }

    const store = await loadBrochureStore()
    const pdfBuffer = await generateBrochurePDF(products, { store, title, showPrices })

    const filename = `brochure-${new Date().toISOString().slice(0, 10)}.pdf`
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to generate brochure' }, { status: 500 })
  }
}
