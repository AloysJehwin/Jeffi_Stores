import { NextRequest, NextResponse } from 'next/server'
import { outreachGuard, serverError } from '@controller/lib/outreach/guard'
import { listEvents } from '@controller/lib/outreach/events'

export const dynamic = 'force-dynamic'

// GET ?limit&contactId → the audit trail, newest first.
export async function GET(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const sp = req.nextUrl.searchParams
  const contactId = sp.get('contactId') ?? undefined
  if (contactId && !/^[0-9a-f-]{36}$/i.test(contactId)) return NextResponse.json({ error: 'Invalid contactId' }, { status: 400 })
  const limit = Number(sp.get('limit'))
  if (sp.get('limit') && !(limit >= 1 && limit <= 500)) return NextResponse.json({ error: 'limit must be 1-500' }, { status: 400 })
  try {
    return NextResponse.json({ events: await listEvents({ contactId, limit: limit || 100 }) })
  } catch (e) {
    return serverError(e)
  }
}
