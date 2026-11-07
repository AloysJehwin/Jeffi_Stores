import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import {
  saveIntegrationCredential,
  listIntegrationCredentials,
  deleteIntegrationCredential,
} from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { parseServiceAccountJson } from '@/lib/shared/google-credentials'
import { isSpApiHost } from '@/lib/amazon/sp-api-hosts'

export const dynamic = 'force-dynamic'

// Store-admin integration credentials management. Admin-scope gated; the tenant is taken from the
// request's ALS context (the admin host resolves it), never from the client — a tenant admin can
// only manage their OWN tenant's creds. Secrets are only ever written here (encrypted); GET never
// returns them, only non-secret display fields + status. Providers: google_merchant, amazon_seller,
// razorpay (Meta lives in tenant_social_accounts, managed by the /api/admin/social routes).

const PROVIDERS = ['google_merchant', 'amazon_seller', 'delhivery', 'razorpay'] as const

const PROVIDER_LABELS: Record<(typeof PROVIDERS)[number], string> = {
  google_merchant: 'Google Merchant Center',
  amazon_seller: 'Amazon Seller',
  delhivery: 'Delhivery',
  razorpay: 'Razorpay',
}

async function requireTenant(): Promise<{ tenantId: string } | { error: NextResponse }> {
  // The flagship's credentials live under the platform tenant id, managed the same way.
  return { tenantId: await credentialOwnerId() }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:read')
  if (admin instanceof NextResponse) return admin
  const gate = await requireTenant()
  if ('error' in gate) return gate.error
  const integrations = await listIntegrationCredentials(gate.tenantId)
  return NextResponse.json({ integrations })
}

// The Delhivery token decides who pays the courier (own account vs the platform's wallet billing),
// so only the store owner sets it, from the ecom portal. Removing it here used to leave an
// own-account tenant shipping on the platform key with no wallet charge.
const DELHIVERY_OWNER_MANAGED = 'The Delhivery account is managed by the store owner in the ecom portal.'

// Razorpay keys decide whose bank the store's sales reach: set by the owner, checked live, on the
// Financial → Razorpay settlements card (/api/admin/integrations/razorpay).
const RAZORPAY_OWNER_MANAGED = 'The Razorpay account is managed by the store owner under Financial → Razorpay settlements.'

const PostSchema = z.object({
  provider: z.enum(PROVIDERS),
  config: z.record(z.string(), z.any()),
})

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const gate = await requireTenant()
  if ('error' in gate) return gate.error

  const raw = await request.json().catch(() => null)
  const parsed = PostSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { provider, config } = parsed.data

  let normalized: Record<string, any>
  let meta: Record<string, any>
  if (provider === 'google_merchant') {
    const merchantId = String(config.merchant_id ?? '').trim()
    if (!/^\d{5,20}$/.test(merchantId)) {
      return NextResponse.json({ error: 'Merchant ID must be the numeric Merchant Center account id' }, { status: 400 })
    }
    const dataSource = String(config.data_source ?? '').trim()
    // The store's own OAuth client plus a refresh token issued to it (content scope), or a service account.
    if (config.mode === 'oauth') {
      const f = Object.fromEntries(['client_id', 'client_secret', 'refresh_token'].map(k => [k, String(config[k] ?? '').trim()]))
      if (!/\.apps\.googleusercontent\.com$/.test(f.client_id)) {
        return NextResponse.json({ error: 'OAuth client ID ends with .apps.googleusercontent.com' }, { status: 400 })
      }
      if (!f.client_secret) return NextResponse.json({ error: 'Paste the OAuth client secret' }, { status: 400 })
      if (f.refresh_token.length < 20) return NextResponse.json({ error: 'Paste the OAuth refresh token' }, { status: 400 })
      normalized = { oauth_refresh_token: f.refresh_token, client_id: f.client_id, client_secret: f.client_secret, merchant_id: merchantId }
      meta = { merchant_id: merchantId, connected_via: 'own_oauth' }
    } else {
      let sa: any
      try {
        sa =
          typeof config.service_account_json === 'string'
            ? parseServiceAccountJson(config.service_account_json)
            : { client_email: config.client_email, private_key: config.private_key }
      } catch {
        return NextResponse.json({ error: 'Invalid service account JSON' }, { status: 400 })
      }
      if (!sa?.client_email || !sa?.private_key) {
        return NextResponse.json({ error: 'Service account must include client_email and private_key' }, { status: 400 })
      }
      if (!/gserviceaccount\.com$/.test(String(sa.client_email)) || !String(sa.private_key).includes('PRIVATE KEY')) {
        return NextResponse.json({ error: 'That is not a Google service account key' }, { status: 400 })
      }
      normalized = { client_email: sa.client_email, private_key: sa.private_key, merchant_id: merchantId }
      meta = { merchant_id: merchantId, client_email: sa.client_email, connected_via: 'manual' }
    }
    if (dataSource) normalized.data_source = dataSource
  } else if (provider === 'delhivery') {
    return NextResponse.json({ error: DELHIVERY_OWNER_MANAGED }, { status: 403 })
  } else if (provider === 'razorpay') {
    return NextResponse.json({ error: RAZORPAY_OWNER_MANAGED }, { status: 403 })
  } else {
    const f = Object.fromEntries(
      ['client_id', 'client_secret', 'refresh_token', 'seller_id', 'marketplace_id'].map(k => [
        k,
        String(config[k] ?? '').trim(),
      ])
    )
    const problem = amazonConfigProblem(f)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    const host = String(config.sp_api_host ?? '').trim()
    if (host && !isSpApiHost(host)) return NextResponse.json({ error: 'Choose an SP-API endpoint from the list' }, { status: 400 })
    normalized = { ...f, marketplace_id: f.marketplace_id || 'A21TJRUUN4KGV', ...(host ? { sp_api_host: host } : {}) }
    meta = {
      seller_id: f.seller_id,
      marketplace_id: normalized.marketplace_id,
      connected_via: 'manual',
      ...(host ? { sp_api_host: host } : {}),
    }
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

function amazonConfigProblem(f: Record<string, string>): string | null {
  for (const k of ['client_id', 'client_secret', 'refresh_token', 'seller_id']) {
    if (!f[k]) return `${k} is required`
  }
  if (!/^amzn1\.application-oa2-client\.[A-Za-z0-9]+$/.test(f.client_id)) {
    return 'Client ID should look like amzn1.application-oa2-client.… (the LWA client id of your SP-API app)'
  }
  if (!f.refresh_token.startsWith('Atzr|')) return 'Refresh token should start with Atzr|'
  if (!/^[A-Z0-9]{8,20}$/.test(f.seller_id)) return 'Seller ID should be your Merchant Token (e.g. A1B2C3D4E5F6G7)'
  if (f.marketplace_id && !/^[A-Z0-9]{8,20}$/.test(f.marketplace_id)) return 'Marketplace ID is not valid'
  return null
}

const DeleteSchema = z.object({ provider: z.enum(PROVIDERS) })

export async function DELETE(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const gate = await requireTenant()
  if ('error' in gate) return gate.error

  const raw = await request.json().catch(() => null)
  const parsed = DeleteSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  if (parsed.data.provider === 'delhivery') {
    return NextResponse.json({ error: DELHIVERY_OWNER_MANAGED }, { status: 403 })
  }
  if (parsed.data.provider === 'razorpay') {
    return NextResponse.json({ error: RAZORPAY_OWNER_MANAGED }, { status: 403 })
  }

  await deleteIntegrationCredential(gate.tenantId, parsed.data.provider)
  return NextResponse.json({ ok: true })
}
