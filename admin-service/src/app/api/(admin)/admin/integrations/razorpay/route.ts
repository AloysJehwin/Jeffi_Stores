import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { testRazorpay, verifyRazorpayKeys } from '@/lib/integrations/test-connection'
import { razorpayAccountFor, type RazorpayAccountInfo } from '@/lib/payments/rzp-account'
import { lastRazorpayWebhook } from '@/lib/payments/rzp-webhook-health'
import { RAZORPAY_WEBHOOK_EVENTS } from '@/lib/payments/razorpay-events/dispatch'

export const dynamic = 'force-dynamic'

// The store's Razorpay account. Its keys decide whose bank customers' money reaches, so only the store
// owner changes them, only on a store set up to collect on its own account, and only after Razorpay
// accepts them. The flagship's keys come from the server environment and are shown read-only.

const mask = (k: string) => (k.length > 12 ? `${k.slice(0, 9)}…${k.slice(-4)}` : k)
const base = () => (process.env.PUBLIC_WEBHOOK_BASE_URL || process.env.APP_URL || `https://${ROOT_DOMAIN}`).replace(/\/$/, '')


export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const account = await razorpayAccountFor()
  const own = account.ownFlag
  const creds = account.kind === 'route' && !own ? null : await resolveRazorpayCreds(account.tenantId ?? undefined).catch(() => null)
  const keyId = creds && (account.kind === 'platform' || creds.isOwn) ? creds.key_id || null : null
  const info: RazorpayAccountInfo = {
    kind: account.kind,
    ownFlag: own,
    editable: own && isPlatformOwner(admin.role) && hasScope(admin.role, admin.scopes, 'financial:write'),
    keyId: keyId ? mask(keyId) : null,
    mode: keyId ? (keyId.startsWith('rzp_live_') ? 'live' : 'test') : null,
    webhookSecretSet: !!(creds && (account.kind === 'platform' || creds.isOwn) && creds.webhook_secret),
    webhookUrl:
      account.kind === 'platform' ? `${base()}/api/webhooks/razorpay` : own && account.slug ? `${base()}/api/webhooks/razorpay/${account.slug}` : null,
    events: RAZORPAY_WEBHOOK_EVENTS.filter(e => account.kind === 'platform' || !e.platformOnly).map(e => e.event),
    lastWebhookAt: account.kind === 'route' && !own ? null : await lastRazorpayWebhook(account.tenantId),
  }
  return NextResponse.json(info)
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('test') }),
  z.object({
    action: z.literal('save'),
    key_id: z.string().trim().min(1),
    key_secret: z.string().trim().min(1),
    webhook_secret: z.string().trim().optional(),
  }),
])

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const account = await razorpayAccountFor()

  if (parsed.data.action === 'test') return NextResponse.json(await testRazorpay(account.tenantId ?? undefined))

  if (!account.tenantId || !account.ownFlag)
    return NextResponse.json({ error: 'This store collects on the platform account; its Razorpay keys are not set here.' }, { status: 403 })
  if (!isPlatformOwner(admin.role)) return NextResponse.json({ error: 'Only the store owner can change the Razorpay keys.' }, { status: 403 })

  const { key_id, key_secret } = parsed.data
  const check = await verifyRazorpayKeys(key_id, key_secret)
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 })

  const existing = await getIntegrationCredential(account.tenantId, 'razorpay').catch(() => null)
  const prev = existing ? await resolveRazorpayCreds(account.tenantId).catch(() => null) : null
  const webhookSecret = parsed.data.webhook_secret || (prev?.isOwn ? prev.webhook_secret : undefined)
  await saveIntegrationCredential({
    tenantId: account.tenantId,
    provider: 'razorpay',
    label: 'Razorpay',
    configEnc: encryptToken(JSON.stringify({ key_id, key_secret, webhook_secret: webhookSecret })),
    meta: { ...(existing?.meta ?? {}), key_id, updated_at: new Date().toISOString(), updated_by: admin.email ?? admin.adminId ?? null },
  })
  return NextResponse.json({ ok: true, message: check.message, webhookSecretSet: !!webhookSecret })
}
