import { NextRequest, NextResponse } from 'next/server'
import { clientInfoFrom, startDeviceAuth, TOKEN_TTLS } from '@/lib/auth/api-tokens'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'
import { ap } from '@/lib/shared/admin-path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'cache-control': 'no-store' }

// `jeffi login`, step 1 (RFC 8628): a device code for the CLI and a user code for the browser. Public;
// the login only becomes a token once a signed-in admin approves it at verification_uri.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {}
  if (body.client_id !== undefined && (typeof body.client_id !== 'string' || body.client_id.length > 64)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400, headers: NO_STORE })
  }
  const tenantId = getCurrentTenant()?.tenantId ?? request.headers.get('x-tenant-id') ?? null
  const client = clientInfoFrom(request, typeof body.client_name === 'string' ? body.client_name : typeof body.client_id === 'string' ? body.client_id : null)
  const r = await startDeviceAuth(tenantId, client)

  const host = client.host
  const local = /(^|\.)localhost(:\d+)?$/.test(host)
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || (local ? 'http' : 'https')
  const uri = `${proto}://${host}${ap('/admin/cli/authorize', host)}`
  const hint = new URLSearchParams({ code: r.userCode })
  if (typeof body.scope === 'string' && /^[a-z0-9_:*,\s]{1,2000}$/i.test(body.scope)) hint.set('scope', body.scope.trim())
  if (typeof body.ttl === 'string' && body.ttl in TOKEN_TTLS) hint.set('ttl', body.ttl)
  return NextResponse.json(
    {
      device_code: r.deviceCode,
      user_code: r.userCode,
      verification_uri: uri,
      verification_uri_complete: `${uri}?${hint}`,
      interval: r.interval,
      expires_in: r.expiresIn,
    },
    { headers: NO_STORE }
  )
}
