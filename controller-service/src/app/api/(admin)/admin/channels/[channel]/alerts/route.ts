import { NextRequest, NextResponse } from 'next/server'
import { CHANNEL_INFO, type Channel } from '@/lib/channels/types'
import { hasScope } from '@/lib/auth/scopes'
import { channelAdmin, readJson } from '@/lib/channels/route'
import { getAlertEmails, getRuleConfig, listChannelAlerts, mergeRuleConfig, saveRuleSettings } from '@/lib/channels/alerts-engine'
import { parseChannel, ruleSetFor } from '@/lib/channels/registry'

export const dynamic = 'force-dynamic'

// Literal write scopes (the scope audit reads them from this file).
const WRITE_SCOPE: Record<Channel, string> = {
  gmc: 'merchant_sync:write',
  amazon: 'amazon:write',
  amazon_ads: 'amazon_ads:write',
  meta_ads: 'meta_ads:write',
  social: 'social:write',
}

type Ctx = { params: Promise<{ channel: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  const channel = parseChannel((await params).channel)
  if (!channel) return NextResponse.json({ error: 'Unknown channel' }, { status: 404 })
  const admin = await channelAdmin(request, CHANNEL_INFO[channel].readScope, CHANNEL_INFO[channel].label)
  if (admin instanceof NextResponse) return admin
  const rs = await ruleSetFor(channel)
  const [alerts, config, emails] = await Promise.all([listChannelAlerts(channel), rs ? getRuleConfig(rs) : null, getAlertEmails(channel)])
  return NextResponse.json({ alerts, config, labels: rs?.labels ?? {}, emails })
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const channel = parseChannel((await params).channel)
  if (!channel) return NextResponse.json({ error: 'Unknown channel' }, { status: 404 })
  const admin = await channelAdmin(request, CHANNEL_INFO[channel].readScope, CHANNEL_INFO[channel].label)
  if (admin instanceof NextResponse) return admin
  if (!hasScope(admin.role, admin.scopes, WRITE_SCOPE[channel])) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const rs = await ruleSetFor(channel)
  if (!rs) return NextResponse.json({ error: 'This channel has no alert rules' }, { status: 404 })
  const body = await readJson(request)
  const parsed = rs.schema.safeParse(mergeRuleConfig(rs, JSON.stringify(body?.config ?? {})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid alert settings' }, { status: 400 })
  await saveRuleSettings(channel, parsed.data, body?.emails !== false)
  return NextResponse.json({ ok: true, config: parsed.data })
}
