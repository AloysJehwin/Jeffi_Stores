import { NextRequest, NextResponse } from 'next/server'
import { sendNotesDigest } from '@/lib/customer-notes-notify'

export const dynamic = 'force-dynamic'

// Daily: owners get one email summarising the customer notes staff added in the last 24h.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const sent = await sendNotesDigest(24)
    return NextResponse.json({ ok: true, notes: sent })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Digest failed' }, { status: 500 })
  }
}
