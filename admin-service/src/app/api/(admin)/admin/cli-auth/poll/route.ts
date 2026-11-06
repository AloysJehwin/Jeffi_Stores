import { NextRequest, NextResponse } from 'next/server'
import { pollDeviceAuth } from '@/lib/auth/api-tokens'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'cache-control': 'no-store' }
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

// `jeffi login`, step 2: the CLI polls with its device code; the jfc_ token comes back exactly once.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {}
  if (body.grant_type !== undefined && body.grant_type !== GRANT_TYPE) {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400, headers: NO_STORE })
  }
  if (typeof body.device_code !== 'string' || !body.device_code) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE })
  }
  const tenantId = getCurrentTenant()?.tenantId ?? request.headers.get('x-tenant-id') ?? null
  const r = await pollDeviceAuth(body.device_code, tenantId)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400, headers: NO_STORE })
  return NextResponse.json(
    {
      access_token: r.token,
      token_type: 'Bearer',
      expires_at: r.expiresAt,
      expires_in: r.expiresAt ? Math.max(0, Math.floor((Date.parse(r.expiresAt) - Date.now()) / 1000)) : null,
      scopes: r.scopes,
      scope: r.scopes.join(' '),
    },
    { headers: NO_STORE }
  )
}
