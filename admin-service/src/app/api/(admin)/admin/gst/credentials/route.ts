import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { getIntegrationCredential, saveIntegrationCredential, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import {
  GST_API_PROVIDERS,
  GST_API_LABEL,
  GST_API_DEFAULT_BASE,
  envGstApiCreds,
  gstApiStore,
  storeGstin,
  validGstBaseUrl,
} from '@/lib/shipping/gst-api-creds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A store's own e-way bill / e-invoice (GSP or NIC) API credentials. Secrets are write-only: GET
// returns the username, base URL and status, never the password or client secret. The flagship
// uses the platform env and has nothing to save here.

const provider = z.enum(['ewaybill', 'einvoice'])
const PostBody = z.object({
  provider,
  username: z.string().trim().min(1, 'Enter the API username'),
  password: z.string().min(1, 'Enter the API password'),
  clientId: z.string().trim().min(1, 'Enter the client ID'),
  clientSecret: z.string().trim().min(1, 'Enter the client secret'),
  baseUrl: z
    .string()
    .trim()
    .optional()
    .refine(v => !v || validGstBaseUrl(v), 'Base URL must be an https address of your GSP or the NIC'),
})

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'gst:read')
  if (admin instanceof NextResponse) return admin
  const tenantId = await gstApiStore()
  const gstin = await storeGstin().catch(() => null)
  const providers = await Promise.all(
    GST_API_PROVIDERS.map(async p => {
      if (!tenantId) {
        const env = envGstApiCreds(p)
        return { provider: p, connected: !!env, username: env?.username ?? null, baseUrl: env?.baseUrl ?? null }
      }
      const row = await getIntegrationCredential(tenantId, p).catch(() => null)
      const meta = row?.status === 'connected' ? (row.meta ?? {}) : null
      return {
        provider: p,
        connected: !!meta,
        username: meta?.username ? String(meta.username) : null,
        baseUrl: meta ? String(meta.base_url || GST_API_DEFAULT_BASE[p]) : null,
      }
    })
  )
  return NextResponse.json({ flagship: !tenantId, gstin, defaults: GST_API_DEFAULT_BASE, providers })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'gst:write')
  if (admin instanceof NextResponse) return admin
  const parsed = PostBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const b = parsed.data
  const tenantId = await gstApiStore()
  if (!tenantId) {
    return NextResponse.json({ error: `This store uses the platform's ${GST_API_LABEL[b.provider]} credentials.` }, { status: 400 })
  }
  const config = {
    username: b.username,
    password: b.password,
    client_id: b.clientId,
    client_secret: b.clientSecret,
    ...(b.baseUrl ? { base_url: b.baseUrl.replace(/\/+$/, '') } : {}),
  }
  await saveIntegrationCredential({
    tenantId,
    provider: b.provider,
    label: b.provider === 'ewaybill' ? 'E-way bill API' : 'E-invoice API',
    configEnc: encryptToken(JSON.stringify(config)),
    meta: { username: b.username, base_url: config.base_url ?? null, connected_via: 'manual' },
  })
  await audit(request, admin.adminId, `Saved the ${GST_API_LABEL[b.provider]} API credentials`)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdminScope(request, 'gst:write')
  if (admin instanceof NextResponse) return admin
  const parsed = z.object({ provider }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  const tenantId = await gstApiStore()
  if (!tenantId) return NextResponse.json({ error: 'Nothing to remove on this store.' }, { status: 400 })
  await deleteIntegrationCredential(tenantId, parsed.data.provider)
  await audit(request, admin.adminId, `Removed the ${GST_API_LABEL[parsed.data.provider]} API credentials`)
  return NextResponse.json({ ok: true })
}

function audit(request: NextRequest, adminId: string | null, summary: string) {
  return logAdminAudit({ adminId, action: 'update', entityType: 'system', entityId: null, summary, request })
}
