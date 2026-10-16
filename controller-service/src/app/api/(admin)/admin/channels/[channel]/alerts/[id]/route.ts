import { NextRequest, NextResponse } from 'next/server'
import { CHANNEL_INFO, type Channel } from '@/lib/channels/types'
import { hasScope } from '@/lib/auth/scopes'
import { channelAdmin } from '@/lib/channels/route'
import { dismissChannelAlert } from '@/lib/channels/alerts-engine'
import { parseChannel } from '@/lib/channels/registry'

export const dynamic = 'force-dynamic'

// Literal write scopes (the scope audit reads them from this file).
const WRITE_SCOPE: Record<Channel, string> = {
  gmc: 'merchant_sync:write',
  amazon: 'amazon:write',
  amazon_ads: 'amazon_ads:write',
  meta_ads: 'meta_ads:write',
  social: 'social:write',
}

/** Dismiss an open alert; it stays dismissed until the condition clears and comes back. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ channel: string; id: string }> }) {
  const p = await params
  const channel = parseChannel(p.channel)
  if (!channel || !/^\d+$/.test(p.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = await channelAdmin(request, CHANNEL_INFO[channel].readScope, CHANNEL_INFO[channel].label)
  if (admin instanceof NextResponse) return admin
  if (!hasScope(admin.role, admin.scopes, WRITE_SCOPE[channel])) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const ok = await dismissChannelAlert(channel, p.id, admin.email ?? null)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Alert not found or not open' }, { status: 404 })
}
