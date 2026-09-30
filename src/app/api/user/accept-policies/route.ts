import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, authenticateBusiness } from '@/lib/jwt'
import { query } from '@/lib/db'
import { POLICY_VERSION } from '@/lib/legals/policies'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const portal = request.headers.get('x-auth-portal')
  const auth =
    portal === 'business'
      ? await authenticateBusiness(request)
      : (await authenticateUser(request)) || (await authenticateBusiness(request))
  if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const version = typeof body?.version === 'string' && body.version.length <= 64 ? body.version : POLICY_VERSION
  if (version !== POLICY_VERSION) {
    return NextResponse.json({ error: 'Stale policy version' }, { status: 400 })
  }

  await query(`UPDATE users SET policies_accepted_version = $1, policies_accepted_at = NOW() WHERE id = $2`, [
    POLICY_VERSION,
    auth.userId,
  ])

  return NextResponse.json({ ok: true, version: POLICY_VERSION })
}
