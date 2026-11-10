import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { deleteIntegrationCredential, getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { storedPhonePeCreds } from '@/lib/integrations/resolve'
import { testPhonePe, verifyPhonePeCreds } from '@/lib/integrations/test-connection'
import { phonePeAccountFor, type PhonePeAccount } from '@/lib/payments/phonepe-account'
import { phonePeAccountInfo } from '@/lib/payments/upi/settings'
import { invalidateUpiModeCache } from '@/lib/payments/upi/creds'

export const dynamic = 'force-dynamic'

// A merchant's PhonePe Business credentials for UPI (docs/PAYMENTS_UPI.md): a store's, or the platform's
// (saved under the platform tenant id; env PHONEPE_* is the fallback). Like the Razorpay keys they decide
// whose account customers' money reaches, so only the owner changes them, and only after PhonePe accepts
// them. Saving switches that merchant's UPI to PhonePe at once; removing switches it back to its UPI ID.

async function forbidUnlessOwner(request: NextRequest): Promise<{ admin: { email?: string | null; adminId?: string }; account: PhonePeAccount } | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!isPlatformOwner(admin.role)) return NextResponse.json({ error: 'Only the owner can change the PhonePe credentials.' }, { status: 403 })
  return { admin, account: await phonePeAccountFor() }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await phonePeAccountInfo(await phonePeAccountFor(), admin))
}

const Body = z.object({
  env: z.enum(['sandbox', 'production']),
  client_id: z.string().trim().min(1).max(200),
  client_secret: z.string().trim().min(1).max(500),
  client_version: z.string().trim().min(1).max(32),
  merchant_id: z.string().trim().max(120).optional(),
  webhook_username: z.string().trim().max(200).optional(),
  webhook_password: z.string().trim().max(500).optional(),
})

/** Save the credentials after PhonePe accepts them. Blank webhook fields keep the saved ones. */
export async function PUT(request: NextRequest) {
  const gate = await forbidUnlessOwner(request)
  if (gate instanceof NextResponse) return gate
  const { admin, account } = gate
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const b = parsed.data

  const check = await verifyPhonePeCreds(b)
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 })

  const prev = await storedPhonePeCreds(account.credTenantId).catch(() => null)
  const existing = prev ? await getIntegrationCredential(account.credTenantId, 'phonepe').catch(() => null) : null
  const blob = {
    env: b.env,
    client_id: b.client_id,
    client_secret: b.client_secret,
    client_version: b.client_version,
    merchant_id: b.merchant_id || prev?.merchant_id || undefined,
    webhook_username: b.webhook_username || prev?.webhook_username || undefined,
    webhook_password: b.webhook_password || prev?.webhook_password || undefined,
  }
  await saveIntegrationCredential({
    tenantId: account.credTenantId,
    provider: 'phonepe',
    label: 'PhonePe',
    configEnc: encryptToken(JSON.stringify(blob)),
    meta: {
      ...(existing?.meta ?? {}),
      env: b.env,
      client_id: b.client_id,
      client_version: b.client_version,
      merchant_id: blob.merchant_id ?? null,
      webhook_auth_set: !!(blob.webhook_username && blob.webhook_password),
      updated_at: new Date().toISOString(),
      updated_by: admin.email ?? admin.adminId ?? null,
    },
  })
  invalidateUpiModeCache()
  return NextResponse.json({ ok: true, message: check.message, webhookAuthSet: !!(blob.webhook_username && blob.webhook_password) })
}

/** `?action=test`: the saved creds (the platform's: saved, else env) against PhonePe. */
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (request.nextUrl.searchParams.get('action') !== 'test') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const account = await phonePeAccountFor()
  return NextResponse.json(await testPhonePe(account.tenantId ?? undefined))
}

/** Remove the saved creds: the merchant goes back to its UPI ID (the platform to its env creds, if set). */
export async function DELETE(request: NextRequest) {
  const gate = await forbidUnlessOwner(request)
  if (gate instanceof NextResponse) return gate
  await deleteIntegrationCredential(gate.account.credTenantId, 'phonepe')
  invalidateUpiModeCache()
  return NextResponse.json({ ok: true })
}
