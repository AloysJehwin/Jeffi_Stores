import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { controlPlanePool } from '@/lib/tenant-registry'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { invalidateSmsDltConfig } from '@/lib/providers/sms-dlt'
import {
  PLATFORM_ONLY_PROVIDER_KEYS,
  PROVIDER_SETTING_KEYS,
  STORE_EDITABLE_PROVIDER_KEYS,
  type ProviderSettingKey,
  clearProviderSetting,
  listProviderSettings,
  normalizeProviderValue,
  setProviderSetting,
} from '@/lib/providers/policy'
import { messagingProviderReadiness } from '@/lib/shared/messaging'
import { aiGatewayHeaders } from '@/lib/shared/ai-client'

export const dynamic = 'force-dynamic'

// Settings → Providers. The flagship administrator edits the platform default or one store's overrides;
// a store admin (tenant resolved) sees and edits only its own store's AI routing and models. No credential
// is accepted or returned: secrets are shown by name and presence only.

const UUID = /^[0-9a-f-]{36}$/i
const keyOf = (v: unknown) => PROVIDER_SETTING_KEYS.find(k => k === v) as ProviderSettingKey | undefined
const MESSAGING_KEYS: ProviderSettingKey[] = ['sms_provider', 'whatsapp_provider']

type Actor = { admin: { adminId?: string; email?: string; role: string; scopes: string[] }; flagship: boolean; tenantId: string | null }

/** Flagship platform owner (tenantId null) or a store admin (its own tenant id); else a refusal. */
async function actor(scope: 'settings:read' | 'settings:write', req: NextRequest): Promise<Actor | NextResponse> {
  const admin = await requireAdminScope(req, scope)
  if (admin instanceof NextResponse) return admin
  const tenant = await resolveTenantId().catch(() => 'unknown' as const)
  if (!tenant) {
    if (!isPlatformOwner(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    return { admin, flagship: true, tenantId: null }
  }
  if (tenant === 'unknown') return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return { admin, flagship: false, tenantId: tenant }
}

/** tenantId: null/absent = platform default; else a store uuid. undefined = invalid. */
function scopeOf(v: unknown): string | null | undefined {
  if (v == null || v === '') return null
  return typeof v === 'string' && UUID.test(v) ? v : undefined
}

type Gateway = { gateway: any | null; gatewayError?: string }

async function gatewayProviders(): Promise<Gateway> {
  const base = (process.env.AI_GATEWAY_URL || '').replace(/\/$/, '')
  if (!base) return { gateway: null, gatewayError: 'AI_GATEWAY_URL is not set' }
  try {
    const r = await fetch(`${base}/v1/providers`, { headers: aiGatewayHeaders(), signal: AbortSignal.timeout(2500), cache: 'no-store' })
    if (!r.ok) return { gateway: null, gatewayError: `AI gateway answered HTTP ${r.status}` }
    return { gateway: await r.json() }
  } catch (err: any) {
    return { gateway: null, gatewayError: `AI gateway unreachable: ${err?.message || 'request failed'}` }
  }
}

const configured = (list: unknown, name: string): boolean =>
  Array.isArray(list) && list.some((p: any) => p?.name === name && p?.configured)

type Secret = { name: string; group: 'ai' | 'messaging' | 'calling' | 'voice'; present: boolean }

function aiSecrets(gw: any | null): Secret[] {
  const any = (name: string, ...caps: string[]) => caps.some(c => configured(gw?.[c], name))
  const mk = (name: string, present: boolean): Secret => ({ name, group: 'ai', present })
  return [
    mk('AZURE_OPENAI_API_KEY', any('azure', 'text', 'embed', 'image', 'video')),
    mk('GOOGLE_AI_API_KEY', any('google', 'image', 'video')),
    mk('REPLICATE_API_TOKEN', any('replicate', 'image', 'video')),
    mk('SARVAM_API_KEY', any('sarvam', 'stt', 'tts')),
    mk('Anthropic federation', any('anthropic', 'text')),
  ]
}

function messagingSecrets(): Secret[] {
  const has = (n: string) => !!(process.env[n] || '').trim()
  return [
    { name: 'TWILIO_ACCOUNT_SID', group: 'messaging', present: has('TWILIO_ACCOUNT_SID') },
    { name: 'TWILIO_AUTH_TOKEN', group: 'messaging', present: has('TWILIO_AUTH_TOKEN') },
    { name: 'AWS (platform role)', group: 'messaging', present: true },
  ]
}

const CALLING_ENV = ['EXOTEL_API_KEY', 'EXOTEL_API_TOKEN', 'SARVAM_API_KEY', 'AZURE_SPEECH_KEY']

/** Calling/voice secrets and the voice view come from voice-config.ts (V2); loaded lazily with a plain
 *  env-presence fallback so this route stands on its own. */
async function voiceParts(): Promise<{ secrets: Secret[]; voice: unknown }> {
  const m: any = await import('@/lib/providers/voice-config').catch(() => ({}))
  const secrets: Secret[] =
    typeof m.voiceSecretsStatus === 'function'
      ? m.voiceSecretsStatus()
      : CALLING_ENV.map(name => ({ name, group: 'calling' as const, present: !!(process.env[name] || '').trim() }))
  const view = typeof m.getVoiceConfigView === 'function' ? m.getVoiceConfigView : m.getVoiceConfigPublic
  const voice = typeof view === 'function' ? await Promise.resolve(view()).catch(() => null) : null
  return { secrets, voice }
}

const asMap = (rows: { key: string; value: unknown }[]) => Object.fromEntries(rows.map(r => [r.key, r.value]))

export async function GET(req: NextRequest) {
  const a = await actor('settings:read', req)
  if (a instanceof NextResponse) return a
  const asked = scopeOf(req.nextUrl.searchParams.get('tenant'))
  if (asked === undefined) return NextResponse.json({ error: 'Invalid tenant' }, { status: 400 })
  const tenantId = a.flagship ? asked : a.tenantId
  const canWrite = !(await requireAdminScope(req, 'settings:write').then(r => r instanceof NextResponse))
  try {
    const cp = controlPlanePool()
    const [rows, gw, prices, tenants, name] = await Promise.all([
      listProviderSettings(),
      gatewayProviders(),
      cp.query(
        `SELECT capability, provider, model, unit_type, price_inr FROM ai_price_list WHERE active ORDER BY capability, provider, model, unit_type`
      ),
      a.flagship ? cp.query(`SELECT id, slug, display_name FROM tenants WHERE status NOT IN ('terminated','rejected') ORDER BY display_name`) : null,
      tenantId ? cp.query(`SELECT display_name FROM tenants WHERE id = $1::uuid`, [tenantId]) : null,
    ])
    const platform = asMap(rows.filter(r => !r.tenant_id))
    const own = tenantId ? asMap(rows.filter(r => r.tenant_id === tenantId)) : {}
    // A store never sees the flagship-only keys (voice, DLT ids).
    const visible = (m: Record<string, unknown>) =>
      a.flagship
        ? m
        : Object.fromEntries(
            Object.entries(m).filter(([k]) => STORE_EDITABLE_PROVIDER_KEYS.includes(k as ProviderSettingKey) || MESSAGING_KEYS.includes(k as ProviderSettingKey))
          )
    const body: Record<string, unknown> = {
      scope: tenantId
        ? { kind: 'store', tenantId, tenantName: (name?.rows[0] as any)?.display_name ?? undefined }
        : { kind: 'platform' },
      canEdit: {
        messaging: a.flagship && canWrite,
        calling: a.flagship && canWrite && !tenantId,
        ai: canWrite,
        integrations: false,
      },
      settings: visible(tenantId ? { ...platform, ...own } : platform),
      inherited: tenantId ? visible(platform) : {},
      overridden: Object.keys(visible(own)),
      gateway: gw.gateway,
      ...(gw.gatewayError ? { gatewayError: gw.gatewayError } : {}),
      prices: prices.rows,
      messaging: messagingProviderReadiness(),
    }
    if (a.flagship) {
      const v = await voiceParts()
      const seen = new Set<string>()
      body.secrets = [...aiSecrets(gw.gateway), ...messagingSecrets(), ...v.secrets].filter(s => !seen.has(s.name) && seen.add(s.name))
      body.voice = v.voice
      body.tenants = tenants?.rows ?? []
    }
    return NextResponse.json(body)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const a = await actor('settings:write', req)
  if (a instanceof NextResponse) return a
  const b = await req.json().catch(() => ({}))
  const key = keyOf(b.key)
  const tenantId = a.flagship ? scopeOf(b.tenantId) : a.tenantId
  if (!key || tenantId === undefined) return NextResponse.json({ error: 'A valid key and tenantId (or null) are required' }, { status: 400 })
  if (!a.flagship && (!STORE_EDITABLE_PROVIDER_KEYS.includes(key) || (b.tenantId && b.tenantId !== a.tenantId))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (tenantId && PLATFORM_ONLY_PROVIDER_KEYS.includes(key)) return NextResponse.json({ error: `${key} is set for the platform only` }, { status: 400 })
  const value = normalizeProviderValue(key, b.value)
  if (value === null) return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 })
  if (value === 'aws' && (key === 'sms_provider' || key === 'whatsapp_provider')) {
    const ready = messagingProviderReadiness()[key === 'sms_provider' ? 'sms' : 'whatsapp'].aws
    if (!ready) return NextResponse.json({ error: 'AWS is unavailable until onboarding completes' }, { status: 400 })
  }
  try {
    await setProviderSetting(tenantId, key, value, a.admin.email || a.admin.adminId || null)
    invalidateSmsDltConfig()
    return NextResponse.json({ ok: true, tenantId, key, value })
  } catch (err: any) {
    if (err?.code === '23503') return NextResponse.json({ error: 'Unknown store' }, { status: 400 })
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const a = await actor('settings:write', req)
  if (a instanceof NextResponse) return a
  const sp = req.nextUrl.searchParams
  const key = keyOf(sp.get('key'))
  const tenantId = a.flagship ? scopeOf(sp.get('tenantId')) : a.tenantId
  if (!key || tenantId === undefined) return NextResponse.json({ error: 'A valid key and tenantId (or none) are required' }, { status: 400 })
  if (!a.flagship && (!STORE_EDITABLE_PROVIDER_KEYS.includes(key) || (sp.get('tenantId') && sp.get('tenantId') !== a.tenantId))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  try {
    const removed = await clearProviderSetting(tenantId, key)
    invalidateSmsDltConfig()
    return NextResponse.json({ ok: true, removed })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
