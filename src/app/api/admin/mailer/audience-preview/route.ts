import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

interface Recipient {
  email: string
  first_name: string | null
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { audience_type, audience_filter } = await request.json()

  const base = `SELECT u.email, u.first_name FROM users u`
  const where = `WHERE u.is_active = true AND u.is_guest = false AND u.email IS NOT NULL`

  let recipients: Recipient[]

  if (audience_type === 'order_history') {
    const days = (audience_filter?.daysSinceOrder as number) || 30
    recipients = await queryMany<Recipient>(
      `${base} ${where} AND u.id IN (SELECT DISTINCT user_id FROM orders WHERE created_at > NOW() - INTERVAL '${days} days' AND user_id IS NOT NULL)`
    )
  } else {
    recipients = await queryMany<Recipient>(`${base} ${where}`)
  }

  return NextResponse.json({ count: recipients.length, recipients })
}
