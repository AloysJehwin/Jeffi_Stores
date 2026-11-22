import { NextRequest, NextResponse } from 'next/server'
import { CHANNEL_INFO } from '@/lib/channels/types'
import { hasScope } from '@/lib/auth/scopes'
import { channelAdmin, actorOf } from '@/lib/channels/route'
import {
  APPROVAL_STATUSES,
  isGatedChannel,
  listBrandApprovals,
  requiresApproval,
  setBrandApproval,
  type ApprovalStatus,
  type GatedChannel,
} from '@/lib/channels/brand-approvals'

export const dynamic = 'force-dynamic'

// Literal write scopes (the scope audit reads them from this file).
const WRITE_SCOPE: Record<GatedChannel, string> = {
  gmc: 'merchant_sync:write',
  amazon: 'amazon:write',
  meta_ads: 'meta_ads:write',
  myntra: 'myntra:write',
  ajio: 'ajio:write',
  flipkart: 'flipkart:write',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every brand with its product count and whether it may be pushed to this channel. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params
  if (!isGatedChannel(channel)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = await channelAdmin(request, CHANNEL_INFO[channel].readScope, CHANNEL_INFO[channel].label)
  if (admin instanceof NextResponse) return admin
  const brands = await listBrandApprovals(channel)
  return NextResponse.json({ channel, requiresApproval: requiresApproval(channel), brands })
}

/** Set a brand's approval for this channel ({ brandId, status: approved | pending | not_approved | null, note?, approvalUrl? }). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params
  if (!isGatedChannel(channel)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = await channelAdmin(request, CHANNEL_INFO[channel].readScope, CHANNEL_INFO[channel].label)
  if (admin instanceof NextResponse) return admin
  if (!hasScope(admin.role, admin.scopes, WRITE_SCOPE[channel])) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const brandId = typeof body.brandId === 'string' && UUID.test(body.brandId) ? body.brandId : null
  const status: ApprovalStatus | null = body.status === null ? null : APPROVAL_STATUSES.includes(body.status) ? body.status : (undefined as any)
  if (!brandId || status === undefined) return NextResponse.json({ error: 'brandId and status (approved, pending, not_approved or null) are required' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : body.note === null ? null : undefined
  const approvalUrl = typeof body.approvalUrl === 'string' && /^https:\/\//.test(body.approvalUrl) ? body.approvalUrl.slice(0, 500) : null
  const out = await setBrandApproval(channel, brandId, status, { note, approvalUrl }, actorOf(admin))
  if (!out.ok) return NextResponse.json({ error: out.problems.join(' ') || 'Could not save', problems: out.problems }, { status: 400 })
  return NextResponse.json({ ok: true, status })
}
