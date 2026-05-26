import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { generateShelfLabelPDF, ShelfLabelItem } from '@/lib/label-pdf'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const { location_ids, items: directItems, copies } = body
    const copiesNum = Math.min(Math.max(parseInt(copies) || 1, 1), 50)

    let items: ShelfLabelItem[]

    if (Array.isArray(directItems) && directItems.length > 0) {
      items = directItems as ShelfLabelItem[]
    } else {
      if (!Array.isArray(location_ids) || location_ids.length === 0) {
        return NextResponse.json({ error: 'location_ids required' }, { status: 400 })
      }
      if (location_ids.length > 100) {
        return NextResponse.json({ error: 'Maximum 100 labels per download' }, { status: 400 })
      }

      const rows = await queryMany<{
        display_code: string
        warehouse_name: string
      }>(
        `SELECT sl.display_code, w.name AS warehouse_name
         FROM shelf_locations sl JOIN warehouses w ON w.id = sl.warehouse_id
         WHERE sl.id = ANY($1::uuid[])`,
        [location_ids]
      )

      if (rows.length === 0) return NextResponse.json({ error: 'No locations found' }, { status: 404 })

      items = rows.map(r => ({
        displayCode: r.display_code,
        warehouseName: r.warehouse_name,
      }))
    }

    const pdfBuffer = await generateShelfLabelPDF(items, copiesNum)
    const filename = `shelf-labels-${new Date().toISOString().slice(0, 10)}.pdf`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to generate labels' }, { status: 500 })
  }
}
