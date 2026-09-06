import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { logAdminAudit } from '@/lib/admin-audit'
import { buildTemplateWorkbook } from '@/lib/import/template'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Streams the product bulk-import template (.xlsx) with every product/variant/sub-variant
// column. products:read gated. Downloading is an export of the schema shape, not data.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  const buf = await buildTemplateWorkbook()

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'export',
    entityType: 'product',
    summary: 'Downloaded product bulk-import template',
    request,
  })

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="product-import-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
