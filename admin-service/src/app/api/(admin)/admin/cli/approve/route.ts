import { NextRequest, NextResponse } from 'next/server'
import { signedInAdmin } from '@/lib/auth/admin-principal'
import { approveDeviceAuth, grantableScopes, tokenTtlSeconds } from '@/lib/auth/api-tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The browser half of `jeffi login`: the signed-in admin approves (or denies) a user code. The token can
// never do more than this admin can, and an administrator's lasts at most a day.
export async function POST(request: NextRequest) {
  const admin = await signedInAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Sign in to approve a CLI login' }, { status: 401 })

  let body: { user_code?: unknown; decision?: unknown; scopes?: unknown; ttl?: unknown } = {}
  try {
    body = await request.json()
  } catch {}
  if (typeof body.user_code !== 'string') return NextResponse.json({ error: 'user_code is required' }, { status: 400 })
  const decision = body.decision === 'deny' ? 'deny' : body.decision === 'approve' ? 'approve' : null
  if (!decision) return NextResponse.json({ error: 'decision must be approve or deny' }, { status: 400 })

  let scopes: string[] = []
  let ttl = 0
  if (decision === 'approve') {
    const s = grantableScopes(body.scopes, { role: admin.role, scopes: admin.scopes, tenantId: admin.tenantId })
    if (!s || !s.length) return NextResponse.json({ error: 'You can only grant scopes you hold' }, { status: 400 })
    const t = tokenTtlSeconds(body.ttl, admin.role)
    if (!t) return NextResponse.json({ error: 'ttl must be 1h, 12h, 24h or 7d' }, { status: 400 })
    scopes = s
    ttl = t
  }

  const r = await approveDeviceAuth({ userCode: body.user_code, tenantId: admin.tenantId, adminId: admin.adminId, adminRole: admin.role, decision, scopes, ttlSeconds: ttl })
  if (r === 'not_found') return NextResponse.json({ error: 'This code has expired or was already used. Run jeffi login again.' }, { status: 404 })
  return NextResponse.json({ status: r, ...(r === 'approved' ? { scopes, expires_at: new Date(Date.now() + ttl * 1000).toISOString() } : {}) })
}
