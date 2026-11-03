import { NextRequest, NextResponse } from 'next/server'
import { listInbox } from '@/lib/support/sessions'
import { adminFor } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

// The customer's open chat (for the chip and the chat modal on their page).
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params
    const admin = await adminFor(request, 'customers:read', { passive: true })
    if (admin instanceof NextResponse) return admin
    const [session] = await listInbox({ filter: 'open', adminId: admin.adminId, customerId: userId, limit: 1 })
    return NextResponse.json({ session: session ?? null })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
