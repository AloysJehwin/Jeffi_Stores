import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import { actorOf, channelError, readJson } from '@/lib/channels/route'
import { runChange } from '@/lib/channels/change-log'
import { CHANNEL_INFO } from '@/lib/channels/types'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { storePublicBaseUrl } from '@/lib/merchant/store-url'
import { IntegrationNotConnectedError, deleteMarketplaceCreds, resolveMarketplaceCreds, saveMarketplaceCreds, type MarketplaceCreds } from '@/lib/integrations/resolve'
import { MARKETPLACE_FIELDS, getAdapter, sendMockTestOrder } from './registry'
import type { MarketplaceChannel, MarketplaceMode } from './types'

// Shared handlers behind /api/admin/{myntra,ajio}/connection. The route files do the scope and plan
// gate; these never return a credential value or the push token except right after it is generated.

export const PUSH_TOKEN_OVERLAP_HOURS = 24
const MODES = ['mock', 'sandbox', 'live'] as const satisfies readonly MarketplaceMode[]

export interface MarketplaceFieldStatus {
  key: string
  label: string
  secret: boolean
  placeholder: string | null
  set: boolean
  /** Only for non-secret fields. */
  value: string | null
}

export interface MarketplaceConnectionStatus {
  channel: MarketplaceChannel
  connected: boolean
  mode: MarketplaceMode | null
  fields: MarketplaceFieldStatus[]
  pushUrl: string
  hasPushToken: boolean
  pushTokenRotatedAt: string | null
  previousTokenValidUntil: string | null
  ipAllowlist: string[]
  lastEventAt: string | null
}

const fieldDefs = (channel: MarketplaceChannel) => MARKETPLACE_FIELDS[channel] ?? []

const label = (channel: MarketplaceChannel) => CHANNEL_INFO[channel].label

async function readCreds(channel: MarketplaceChannel): Promise<MarketplaceCreds | null> {
  try {
    return (await resolveMarketplaceCreds(channel)) ?? null
  } catch (e) {
    if (e instanceof IntegrationNotConnectedError) return null
    throw e
  }
}

export async function marketplacePushUrl(channel: MarketplaceChannel): Promise<string> {
  const tenant = await resolveTenant().catch(() => null)
  const base = tenant?.slug ? `https://${tenant.slug}.${process.env.PLATFORM_DOMAIN || 'jeffistores.in'}` : await storePublicBaseUrl()
  return `${base}/api/webhooks/${channel}`
}

async function lastEventAt(channel: MarketplaceChannel): Promise<string | null> {
  const row = await queryOne<{ at: string | null }>(
    `SELECT MAX(received_at) AS at FROM marketplace_webhook_events WHERE channel = $1`,
    [channel]
  ).catch(() => null)
  return row?.at ? new Date(row.at).toISOString() : null
}

const newToken = () => randomBytes(32).toString('base64url')

function previousValidUntil(c: MarketplaceCreds | null): string | null {
  if (!c?.push_token_prev || !c.push_token_rotated_at) return null
  const until = new Date(c.push_token_rotated_at).getTime() + PUSH_TOKEN_OVERLAP_HOURS * 3600_000
  return Number.isFinite(until) && until > Date.now() ? new Date(until).toISOString() : null
}

/** What the connect panel shows: which fields are set, never their secret values. */
function redact(channel: MarketplaceChannel, c: MarketplaceCreds | null) {
  return fieldDefs(channel).map<MarketplaceFieldStatus>(f => {
    const v = c?.fields?.[f.key]
    return { key: f.key, label: f.label, secret: !!f.secret, placeholder: f.placeholder ?? null, set: !!v, value: f.secret || !v ? null : v }
  })
}

export async function marketplaceConnectionStatus(channel: MarketplaceChannel): Promise<MarketplaceConnectionStatus> {
  const [c, pushUrl, last] = await Promise.all([readCreds(channel), marketplacePushUrl(channel), lastEventAt(channel)])
  return {
    channel,
    connected: !!c,
    mode: c?.mode ?? null,
    fields: redact(channel, c),
    pushUrl,
    hasPushToken: !!c?.push_token,
    pushTokenRotatedAt: c?.push_token_rotated_at ?? null,
    previousTokenValidUntil: previousValidUntil(c),
    ipAllowlist: c?.ip_allowlist ?? [],
    lastEventAt: last,
  }
}

export async function connectionGet(channel: MarketplaceChannel): Promise<NextResponse> {
  try {
    return NextResponse.json(await marketplaceConnectionStatus(channel))
  } catch (e) {
    return channelError(e)
  }
}

const SaveBody = z.object({
  mode: z.enum(MODES),
  fields: z.record(z.string(), z.string().max(2000)).default({}),
})

/** Typed values over the stored ones; a blank input keeps what is saved. */
function mergeCreds(channel: MarketplaceChannel, current: MarketplaceCreds | null, body: z.infer<typeof SaveBody>): MarketplaceCreds {
  const fields: Record<string, string> = {}
  for (const f of fieldDefs(channel)) {
    const typed = body.fields[f.key]?.trim()
    const v = typed || current?.fields?.[f.key]
    if (v) fields[f.key] = v
  }
  return { ...(current ?? {}), mode: body.mode, fields }
}

function missingFields(channel: MarketplaceChannel, creds: MarketplaceCreds): string[] {
  if (creds.mode === 'mock') return []
  const missing = fieldDefs(channel).filter(f => !creds.fields[f.key])
  return missing.length ? [`Enter ${missing.map(f => f.label).join(', ')}.`] : []
}

async function testCreds(channel: MarketplaceChannel, creds: MarketplaceCreds): Promise<{ ok: boolean; message?: string }> {
  try {
    return await getAdapter(channel, creds).test()
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? e) }
  }
}

const refused = (problems: string[], status = 400) => NextResponse.json({ error: problems.join(' ') || 'The change was rejected', problems }, { status })

async function save(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload, testOnly: boolean): Promise<NextResponse> {
  const parsed = SaveBody.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const current = await readCreds(channel)
  const creds = mergeCreds(channel, current, parsed.data)
  const missing = missingFields(channel, creds)
  if (testOnly) {
    if (missing.length) return refused(missing)
    return NextResponse.json(await testCreds(channel, creds))
  }
  let test: { ok: boolean; message?: string } = { ok: false }
  let token: string | null = null
  const outcome = await runChange(
    {
      channel,
      action: current ? 'connection.update' : 'connection.create',
      entityType: 'connection',
      summary: `${current ? 'Updated' : 'Connected'} ${label(channel)} (${creds.mode})`,
      before: current ? { mode: current.mode, fields: Object.keys(current.fields ?? {}).sort() } : null,
      after: { mode: creds.mode, fields: Object.keys(creds.fields).sort() },
      validate: async () => {
        if (missing.length) return missing
        test = await testCreds(channel, creds)
        return test.ok ? [] : [test.message || `${label(channel)} did not accept these details.`]
      },
      apply: async () => {
        if (!creds.push_token) {
          token = newToken()
          creds.push_token = token
          creds.push_token_rotated_at = new Date().toISOString()
        }
        await saveMarketplaceCreds(channel, creds)
      },
    },
    actorOf(admin),
    false
  )
  if (!outcome.ok) return refused(outcome.problems)
  return NextResponse.json({ ok: true, test, pushToken: token, status: await marketplaceConnectionStatus(channel) })
}

async function rotate(channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  const current = await readCreds(channel)
  if (!current) return refused([`Connect ${label(channel)} first.`], 409)
  const token = newToken()
  const outcome = await runChange(
    {
      channel,
      action: 'push_token.rotate',
      entityType: 'connection',
      summary: `Rotated the ${label(channel)} push token; the old one works for ${PUSH_TOKEN_OVERLAP_HOURS} hours`,
      apply: async () => {
        await saveMarketplaceCreds(channel, {
          ...current,
          push_token: token,
          push_token_prev: current.push_token,
          push_token_rotated_at: new Date().toISOString(),
        })
      },
    },
    actorOf(admin),
    false
  )
  if (!outcome.ok) return refused(outcome.problems)
  return NextResponse.json({ ok: true, pushToken: token, status: await marketplaceConnectionStatus(channel) })
}

async function testOrder(channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  const current = await readCreds(channel)
  if (!current) return refused([`Connect ${label(channel)} first.`], 409)
  if (current.mode === 'live') return refused(['Test orders are only for mock or sandbox mode.'], 409)
  const outcome = await runChange(
    {
      channel,
      action: 'test_order.send',
      entityType: 'order',
      summary: `Sent a ${label(channel)} test order (${current.mode})`,
      apply: () => sendMockTestOrder(channel),
    },
    actorOf(admin),
    false
  )
  if (!outcome.ok) return refused(outcome.problems)
  return NextResponse.json({ ok: true, orderNumber: outcome.result?.orderNumber ?? null })
}

/** POST: save + test; `?action=test` tests without saving; `rotate-token`; `test-order`. */
export async function connectionPost(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  const action = request.nextUrl.searchParams.get('action')
  try {
    if (!action) return await save(request, channel, admin, false)
    if (action === 'test') return await save(request, channel, admin, true)
    if (action === 'rotate-token') return await rotate(channel, admin)
    if (action === 'test-order') return await testOrder(channel, admin)
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return channelError(e)
  }
}

/** Disconnect: the stored details and push token go; imported orders and listings stay. */
export async function connectionDelete(channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const outcome = await runChange(
      {
        channel,
        action: 'connection.delete',
        entityType: 'connection',
        summary: `Disconnected ${label(channel)}`,
        apply: () => deleteMarketplaceCreds(channel),
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok) return refused(outcome.problems)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return channelError(e)
  }
}
