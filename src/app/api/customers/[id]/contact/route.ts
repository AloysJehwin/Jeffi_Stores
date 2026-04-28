import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCustomerById } from '@/lib/queries'
import { sendAdminContactEmail } from '@/lib/email'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !hasScope(admin.role, admin.scopes, 'customers')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { subject, message } = await request.json()

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
    }

    const customer = await getCustomerById(params.id)
    const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer'

    await sendAdminContactEmail(customer.email, name, subject, message)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to send message' }, { status: 500 })
  }
}
