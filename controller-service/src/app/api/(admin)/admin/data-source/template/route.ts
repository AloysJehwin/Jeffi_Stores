import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { buildTemplateWorkbook, buildTemplateCsv } from '@/lib/import/template'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Streams the product bulk-import template: the multi-sheet .xlsx (default) or the flat one-sheet
// layout as ?format=csv. products:read gated. Downloading is an export of the schema shape, not data.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  const csv = request.nextUrl.searchParams.get('format') === 'csv'

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'export',
    entityType: 'product',
    summary: `Downloaded product bulk-import template (${csv ? 'csv' : 'xlsx'})`,
    request,
  })

  if (csv) {
    return new NextResponse(buildTemplateCsv(), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="product-import-template.csv"',
        'Cache-Control': 'no-store',
      },
    })
  }

  const buf = await buildTemplateWorkbook()

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="product-import-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
