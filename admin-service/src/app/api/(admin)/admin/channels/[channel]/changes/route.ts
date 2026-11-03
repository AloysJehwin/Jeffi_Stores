import { NextRequest, NextResponse } from 'next/server'
import { CHANNEL_INFO } from '@/lib/channels/types'
import { channelAdmin } from '@/lib/channels/route'
import { listChanges } from '@/lib/channels/change-log'
import { parseChannel } from '@/lib/channels/registry'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const channel = parseChannel((await params).channel)
  if (!channel) return NextResponse.json({ error: 'Unknown channel' }, { status: 404 })
  const admin = await channelAdmin(request, CHANNEL_INFO[channel].readScope, CHANNEL_INFO[channel].label)
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ changes: await listChanges(channel) })
}
