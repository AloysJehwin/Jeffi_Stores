import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { controlPlanePool } from '@/lib/tenant-registry'
import {
  PROVIDER_SETTING_KEYS,
  type ProviderSettingKey,
  clearProviderSetting,
  listProviderSettings,
  normalizeProviderValue,
  setProviderSetting,
} from '@/lib/providers/policy'
import { messagingProviderReadiness } from '@/lib/shared/messaging'

export const dynamic = 'force-dynamic'

// Platform provider policy (control plane platform_provider_settings), edited from the flagship's
// Site Controls. Platform owner on the flagship only: a store admin (tenant resolved) never reaches it.

async function platformOnly(admin: Awaited<ReturnType<typeof requireAdminScope>>) {
  if (admin instanceof NextResponse) return admin
  const tenant = await resolveTenantId().catch(() => 'unknown')
  if (!isPlatformOwner(admin.role) || tenant) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}

const UUID = /^[0-9a-f-]{36}$/i
const keyOf = (v: unknown) => PROVIDER_SETTING_KEYS.find(k => k === v) as ProviderSettingKey | undefined

/** tenantId: null/absent = platform default; else a store uuid. undefined = invalid. */
function scopeOf(v: unknown): string | null | undefined {
  if (v == null || v === '') return null
  return typeof v === 'string' && UUID.test(v) ? v : undefined
}

async function gatewayProviders(): Promise<unknown | null> {
  const base = (process.env.AI_GATEWAY_URL || '').replace(/\/$/, '')
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/providers`, { signal: AbortSignal.timeout(2500), cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const admin = await platformOnly(await requireAdminScope(req, 'settings:read'))
  if (admin instanceof NextResponse) return admin
  try {
    const [settings, tenants, gateway] = await Promise.all([
      listProviderSettings(),
      controlPlanePool().query(
        `SELECT id, slug, display_name FROM tenants WHERE status NOT IN ('terminated','rejected') ORDER BY display_name`
      ),
      gatewayProviders(),
    ])
    return NextResponse.json({ settings, tenants: tenants.rows, messaging: messagingProviderReadiness(), gateway })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const admin = await platformOnly(await requireAdminScope(req, 'settings:write'))
  if (admin instanceof NextResponse) return admin
  const b = await req.json().catch(() => ({}))
  const key = keyOf(b.key)
  const tenantId = scopeOf(b.tenantId)
  if (!key || tenantId === undefined) return NextResponse.json({ error: 'A valid key and tenantId (or null) are required' }, { status: 400 })
  const value = normalizeProviderValue(key, b.value)
  if (value === null) return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 })
  if (value === 'aws' && (key === 'sms_provider' || key === 'whatsapp_provider')) {
    const ready = messagingProviderReadiness()[key === 'sms_provider' ? 'sms' : 'whatsapp'].aws
    if (!ready) return NextResponse.json({ error: 'AWS is unavailable until onboarding completes' }, { status: 400 })
  }
  try {
    await setProviderSetting(tenantId, key, value, admin.email || admin.adminId || null)
    return NextResponse.json({ ok: true, tenantId, key, value })
  } catch (err: any) {
    if (err?.code === '23503') return NextResponse.json({ error: 'Unknown store' }, { status: 400 })
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await platformOnly(await requireAdminScope(req, 'settings:write'))
  if (admin instanceof NextResponse) return admin
  const sp = req.nextUrl.searchParams
  const key = keyOf(sp.get('key'))
  const tenantId = scopeOf(sp.get('tenantId'))
  if (!key || tenantId === undefined) return NextResponse.json({ error: 'A valid key and tenantId (or none) are required' }, { status: 400 })
  try {
    const removed = await clearProviderSetting(tenantId, key)
    return NextResponse.json({ ok: true, removed })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
