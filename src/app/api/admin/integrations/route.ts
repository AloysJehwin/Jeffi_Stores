import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/jwt'
import { getCurrentTenant } from '@/lib/tenant-context'
import {
  saveIntegrationCredential,
  listIntegrationCredentials,
  deleteIntegrationCredential,
} from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { parseServiceAccountJson } from '@/lib/google-credentials'

export const dynamic = 'force-dynamic'

// Store-admin integration credentials management. Admin-scope gated; the tenant is taken from the
// request's ALS context (the admin host resolves it), never from the client — a tenant admin can
// only manage their OWN tenant's creds. Secrets are only ever written here (encrypted); GET never
// returns them, only non-secret display fields + status. Providers: google_merchant, amazon_seller
// (Meta lives in tenant_social_accounts, managed by the /api/admin/social routes).

const PROVIDERS = ['google_merchant', 'amazon_seller', 'delhivery', 'razorpay'] as const

const PROVIDER_LABELS: Record<(typeof PROVIDERS)[number], string> = {
  google_merchant: 'Google Merchant Center',
  amazon_seller: 'Amazon Seller',
  delhivery: 'Delhivery',
  razorpay: 'Razorpay',
}

function requireTenant(): { tenantId: string } | { error: NextResponse } {
  const t = getCurrentTenant()
  if (!t) return { error: NextResponse.json({ error: 'No tenant context' }, { status: 400 }) }
  return { tenantId: t.tenantId }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:read')
  if (admin instanceof NextResponse) return admin
  const gate = requireTenant()
  if ('error' in gate) return gate.error
  const integrations = await listIntegrationCredentials(gate.tenantId)
  return NextResponse.json({ integrations })
}

const PostSchema = z.object({
  provider: z.enum(PROVIDERS),
  config: z.record(z.string(), z.any()),
})

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const gate = requireTenant()
  if ('error' in gate) return gate.error

  const raw = await request.json().catch(() => null)
  const parsed = PostSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { provider, config } = parsed.data

  let normalized: Record<string, any>
  let meta: Record<string, any>
  if (provider === 'google_merchant') {
    if (!config.merchant_id) return NextResponse.json({ error: 'merchant_id is required' }, { status: 400 })
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
  } else if (provider === 'delhivery') {
    if (!config.token) return NextResponse.json({ error: 'token is required' }, { status: 400 })
    normalized = { token: String(config.token) }
    meta = {}
  } else if (provider === 'razorpay') {
    if (!config.key_id || !config.key_secret) {
      return NextResponse.json({ error: 'key_id and key_secret are required' }, { status: 400 })
    }
    normalized = {
      key_id: String(config.key_id),
      key_secret: String(config.key_secret),
      webhook_secret: config.webhook_secret ? String(config.webhook_secret) : undefined,
    }
    meta = { key_id: String(config.key_id) }
  } else {
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
    tenantId: gate.tenantId,
    provider,
    label: PROVIDER_LABELS[provider],
    configEnc: encryptToken(JSON.stringify(normalized)),
    meta,
  })
  return NextResponse.json({ ok: true, provider, meta })
}

const DeleteSchema = z.object({ provider: z.enum(PROVIDERS) })

export async function DELETE(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const gate = requireTenant()
  if ('error' in gate) return gate.error

  const raw = await request.json().catch(() => null)
  const parsed = DeleteSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  await deleteIntegrationCredential(gate.tenantId, parsed.data.provider)
  return NextResponse.json({ ok: true })
}
