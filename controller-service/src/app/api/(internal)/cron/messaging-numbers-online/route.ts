import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { activateOnlineWhatsAppNumbers } from '@controller/lib/messaging/tenant-numbers'

export const dynamic = 'force-dynamic'

// Every 5 min: a number bought with Get a number keeps its WhatsApp row pending, so the audience's previous number
// keeps sending, until its WhatsApp sender is Online; this turns it on.
export async function POST(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await activateOnlineWhatsAppNumbers())
}
