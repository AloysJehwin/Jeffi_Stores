import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCustomerById } from '@/lib/queries'
import { query } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !hasScope(admin.role, admin.scopes, 'customers')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const customer = await getCustomerById(params.id)
    return NextResponse.json(customer)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch customer' }, { status: 404 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !hasScope(admin.role, admin.scopes, 'customers')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { action, reason } = await request.json()

    if (action === 'flag') {
      await query(
        'UPDATE users SET is_flagged = true, is_active = false, flag_reason = $1 WHERE id = $2',
        [reason || 'Flagged by admin', params.id]
      )
    } else if (action === 'deactivate') {
      await query('UPDATE users SET is_active = false WHERE id = $1', [params.id])
    } else if (action === 'activate') {
      await query(
        'UPDATE users SET is_active = true, is_flagged = false, flag_reason = null WHERE id = $1',
        [params.id]
      )
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}
