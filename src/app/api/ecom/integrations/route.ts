import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import {
  getOwnerTenants,
  saveIntegrationCredential,
  listIntegrationCredentials,
  deleteIntegrationCredential,
} from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { parseServiceAccountJson } from '@/lib/google-credentials'

export const dynamic = 'force-dynamic'

// Owner-facing integration credentials management. Owner-gated + requires a PROVISIONED
// (active) store. Secrets are only ever written here (encrypted) — GET never returns them,
// only non-secret display fields + status. Providers: google_merchant, amazon_seller
// (Meta lives in tenant_social_accounts and is managed by the /social routes).

const PROVIDERS = ['google_merchant', 'amazon_seller'] as const

async function requireOwnerAndActiveTenant(request: NextRequest, tenantId: string) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  const tenant = (await getOwnerTenants(owner.id)).find((t) => t.id === tenantId)
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }
  if (tenant.status !== 'active') {
    return { error: NextResponse.json({ error: 'Store is not provisioned yet' }, { status: 409 }) }
  }
  return { owner, tenant }
}

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId') || ''
  const gate = await requireOwnerAndActiveTenant(request, tenantId)
  if ('error' in gate) return gate.error
  const integrations = await listIntegrationCredentials(tenantId)
  return NextResponse.json({ integrations })
}

const PostSchema = z.object({
  tenantId: z.string().uuid(),
  provider: z.enum(PROVIDERS),
  config: z.record(z.any()),
})

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null)
  const parsed = PostSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { tenantId, provider, config } = parsed.data

  const gate = await requireOwnerAndActiveTenant(request, tenantId)
  if ('error' in gate) return gate.error

  // Provider-specific validation + non-secret meta for display.
  let normalized: Record<string, any>
  let meta: Record<string, any>
  if (provider === 'google_merchant') {
    if (!config.merchant_id) return NextResponse.json({ error: 'merchant_id is required' }, { status: 400 })
    // Accept either a pasted service-account JSON string or already-parsed fields.
    let sa: any
    try {
      sa = typeof config.service_account_json === 'string'
        ? parseServiceAccountJson(config.service_account_json)
        : { client_email: config.client_email, private_key: config.private_key }
    } catch {
      return NextResponse.json({ error: 'Invalid service account JSON' }, { status: 400 })
    }
    if (!sa.client_email || !sa.private_key) {
      return NextResponse.json({ error: 'Service account must include client_email and private_key' }, { status: 400 })
    }
    normalized = { client_email: sa.client_email, private_key: sa.private_key, merchant_id: String(config.merchant_id) }
    meta = { merchant_id: String(config.merchant_id), client_email: sa.client_email }
  } else {
    // amazon_seller
    const required = ['client_id', 'client_secret', 'refresh_token', 'seller_id']
    for (const k of required) {
      if (!config[k]) return NextResponse.json({ error: `${k} is required` }, { status: 400 })
    }
    normalized = {
      client_id: config.client_id, client_secret: config.client_secret,
      refresh_token: config.refresh_token, seller_id: config.seller_id,
      marketplace_id: config.marketplace_id || 'A21TJRUUN4KGV',
    }
    meta = { seller_id: config.seller_id, marketplace_id: normalized.marketplace_id }
  }

  await saveIntegrationCredential({
    tenantId,
    provider,
    label: provider === 'google_merchant' ? 'Google Merchant Center' : 'Amazon Seller',
    configEnc: encryptToken(JSON.stringify(normalized)),
    meta,
  })
  return NextResponse.json({ ok: true, provider, meta })
}

const DeleteSchema = z.object({ tenantId: z.string().uuid(), provider: z.enum(PROVIDERS) })

export async function DELETE(request: NextRequest) {
  const raw = await request.json().catch(() => null)
  const parsed = DeleteSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { tenantId, provider } = parsed.data

  const gate = await requireOwnerAndActiveTenant(request, tenantId)
  if ('error' in gate) return gate.error

  await deleteIntegrationCredential(tenantId, provider)
  return NextResponse.json({ ok: true })
}
