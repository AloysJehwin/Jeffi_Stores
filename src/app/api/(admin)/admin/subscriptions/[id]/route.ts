import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getAdminSubscriptionDetail } from '@/lib/queries/subscriptions'
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  syncSubscription,
  SubscriptionError,
} from '@/lib/subscriptions/service'

export const dynamic = 'force-dynamic'

const ACTIONS = {
  cancel_now: (id: string) => cancelSubscription(id, { atCycleEnd: false, actor: 'admin' }),
  cancel_at_end: (id: string) => cancelSubscription(id, { atCycleEnd: true, actor: 'admin' }),
  pause: (id: string) => pauseSubscription(id),
  resume: (id: string) => resumeSubscription(id),
  sync: (id: string) => syncSubscription(id),
} as const

type Action = keyof typeof ACTIONS

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'subscriptions:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const detail = await getAdminSubscriptionDetail(id)
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(detail)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'subscriptions:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  const action = body?.action as string | undefined
  if (!action || !Object.hasOwn(ACTIONS, action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  try {
    await ACTIONS[action as Action](id)
  } catch (err) {
    if (err instanceof SubscriptionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Action failed' }, { status: 502 })
  }
  const detail = await getAdminSubscriptionDetail(id)
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(detail)
}
