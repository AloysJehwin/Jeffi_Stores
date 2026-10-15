import { documentUrl } from '../../lib/customer-links'
import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne } from '@jeffi/tenancy'
import { sendQuotationFinalizedEmail } from '../../lib/mail'


export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const qt = await queryOne<any>(
      `SELECT consignee_email, consignee_name, quote_number, total_amount, view_token FROM quotations WHERE id = $1`,
      [id]
    )
    if (!qt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!qt.consignee_email) return NextResponse.json({ error: 'No email address on file' }, { status: 400 })

    const viewUrl = await documentUrl('quotation', qt.view_token)

    await sendQuotationFinalizedEmail(
      qt.consignee_email,
      qt.consignee_name || '',
      qt.quote_number,
      Number(qt.total_amount),
      viewUrl
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
