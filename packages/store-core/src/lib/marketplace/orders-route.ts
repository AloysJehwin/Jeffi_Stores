import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import { actorOf, channelError, readJson } from '@/lib/channels/route'
import { runChange } from '@/lib/channels/change-log'
import { resolveMarketplaceCreds } from '@/lib/integrations/resolve'
import type { DocumentKind } from './adapter'
import { QUEUE_BUCKETS, listReturns, marketplaceOverview, queueOrders, bucketCounts, type QueueBucket } from './console'
import { DOCUMENT_KINDS, DocumentUnavailableError, marketplaceDocument } from './documents'
import { resolveEndpoints } from './endpoints'
import { createMarketplaceManifest, loadManifestCandidates, manifestProblems } from './manifest'
import { ACTION_VERB, QUEUE_ACTIONS, actionProblem, loadActionTargets, runOrderAction } from './order-actions'
import { getAdapter } from './registry'
import { RETURN_ACTIONS, applyReturnAction, loadReturn, returnActionProblem } from './returns'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Shared handlers behind /api/admin/{myntra,ajio}/{console,orders/action,orders/[id]/document,
// manifest,returns/action}. The route files do the scope and plan gate.

const uuid = z.string().uuid()
const notConnected = (channel: MarketplaceChannel) => NextResponse.json({ error: `Connect ${CHANNEL_LABEL[channel]} first.` }, { status: 409 })
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

async function adapterFor(channel: MarketplaceChannel) {
  const creds = await resolveMarketplaceCreds(channel)
  return creds ? { creds, adapter: getAdapter(channel, creds) } : null
}

/** GET ?view=overview (default) | orders&bucket=new|to_pack|rtd|shipped|closed&q= | returns&scope=open|all */
export async function consoleGet(request: NextRequest, channel: MarketplaceChannel): Promise<NextResponse> {
  const sp = request.nextUrl.searchParams
  const view = sp.get('view') ?? 'overview'
  try {
    if (view === 'orders') {
      const raw = sp.get('bucket') ?? 'new'
      if (!(QUEUE_BUCKETS as readonly string[]).includes(raw)) return bad('Unknown bucket')
      const bucket = raw as QueueBucket
      const [orders, counts] = await Promise.all([queueOrders(channel, bucket, sp.get('q')?.slice(0, 100)), bucketCounts(channel)])
      return NextResponse.json({ bucket, counts, orders })
    }
    if (view === 'returns') return NextResponse.json({ returns: await listReturns(channel, sp.get('scope') === 'all' ? 'all' : 'open') })
    if (view !== 'overview') return bad('Unknown view')
    return NextResponse.json(await marketplaceOverview(channel))
  } catch (e) {
    return channelError(e)
  }
}

const PacketSchema = z
  .object({
    weightGrams: z.number().positive().max(100_000).optional(),
    lengthCm: z.number().positive().max(500).optional(),
    breadthCm: z.number().positive().max(500).optional(),
    heightCm: z.number().positive().max(500).optional(),
  })
  .optional()

const ActionBody = z.object({
  action: z.enum(QUEUE_ACTIONS),
  ids: z.array(uuid).min(1).max(100),
  reason: z.string().trim().max(500).optional(),
  packet: PacketSchema,
})

interface ActionRowResult {
  id: string
  ok: boolean
  error?: string
  status?: string
  packetId?: string | null
  trackingNumber?: string | null
}

/** POST { action, ids, reason?, packet? }: accept / reject (reason required) / pack / RTD, one or many. */
export async function ordersActionPost(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  const parsed = ActionBody.safeParse(await readJson(request))
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request')
  const { action, reason, packet } = parsed.data
  const ids = [...new Set(parsed.data.ids)]
  if (action === 'reject' && (reason ?? '').length < 3) return bad('Give a reason for rejecting.')
  try {
    const conn = await adapterFor(channel)
    if (!conn) return notConnected(channel)
    const targets = new Map((await loadActionTargets(channel, ids)).map(t => [t.id, t]))
    const results: ActionRowResult[] = []
    for (const id of ids) {
      const t = targets.get(id)
      if (!t) {
        results.push({ id, ok: false, error: 'Order not found' })
        continue
      }
      const outcome = await runChange(
        {
          channel,
          action: `order.${action}`,
          entityType: 'order',
          entityId: t.external_order_id,
          summary: `${ACTION_VERB[action]} ${CHANNEL_LABEL[channel]} order ${t.external_order_id}${action === 'reject' ? `: ${reason}` : ''}`,
          before: { status: t.status },
          after: { action, ...(reason ? { reason } : {}) },
          validate: () => {
            const p = actionProblem(t, action, reason)
            return p ? [p] : []
          },
          apply: () => runOrderAction(conn.adapter, t, { action, reason, packet }),
        },
        actorOf(admin),
        false
      )
      results.push(
        outcome.ok
          ? { id, ok: true, status: outcome.result?.status, packetId: outcome.result?.shipment?.packetId ?? null, trackingNumber: outcome.result?.shipment?.trackingNumber ?? null }
          : { id, ok: false, error: outcome.problems.join(' ') || 'Failed' }
      )
    }
    const done = results.filter(r => r.ok).length
    if (!done) return NextResponse.json({ ok: false, error: results[0]?.error ?? 'Nothing changed', results }, { status: 400 })
    return NextResponse.json({ ok: true, done, failed: results.length - done, results })
  } catch (e) {
    return channelError(e, `Connect ${CHANNEL_LABEL[channel]} first.`)
  }
}

/** GET ?kind=label|invoice|manifest[&inline=1]: the PDF, from the store's bucket once fetched. */
export async function orderDocumentGet(request: NextRequest, channel: MarketplaceChannel, id: string): Promise<Response> {
  const kind = request.nextUrl.searchParams.get('kind') as DocumentKind | null
  if (!kind || !DOCUMENT_KINDS.includes(kind)) return bad('kind must be label, invoice or manifest')
  if (!uuid.safeParse(id).success) return bad('Order not found', 404)
  try {
    const conn = await adapterFor(channel)
    if (!conn) return notConnected(channel)
    const doc = await marketplaceDocument(channel, id, kind, conn.adapter)
    if (!doc) return bad('Order not found', 404)
    const inline = request.nextUrl.searchParams.get('inline') === '1'
    return new Response(new Uint8Array(doc.body), {
      headers: {
        'Content-Type': doc.contentType || 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${doc.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    if (e instanceof DocumentUnavailableError) return bad(e.message, 409)
    return channelError(e)
  }
}

const ManifestBody = z.object({ ids: z.array(uuid).min(1).max(1000) })

/** POST { ids }: one manifest for the picked ready-to-dispatch orders' packets. */
export async function manifestPost(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  const parsed = ManifestBody.safeParse(await readJson(request))
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request')
  const ids = [...new Set(parsed.data.ids)]
  try {
    const conn = await adapterFor(channel)
    if (!conn) return notConnected(channel)
    if (!conn.adapter.createManifest) return bad(`${CHANNEL_LABEL[channel]} manifests are created on its portal.`, 409)
    const max = resolveEndpoints(channel, conn.creds).batch.manifest
    const rows = ids.length > max ? [] : await loadManifestCandidates(channel, ids)
    const outcome = await runChange(
      {
        channel,
        action: 'manifest.create',
        entityType: 'manifest',
        summary: `Created a ${CHANNEL_LABEL[channel]} manifest for ${ids.length} packet${ids.length === 1 ? '' : 's'}`,
        after: { orders: rows.map(r => r.external_order_id) },
        validate: () => manifestProblems(ids, rows, max),
        apply: () => createMarketplaceManifest(channel, conn.adapter, rows),
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok) return NextResponse.json({ error: outcome.problems.join(' '), problems: outcome.problems }, { status: 400 })
    return NextResponse.json({ ok: true, ...outcome.result })
  } catch (e) {
    return channelError(e)
  }
}

const ReturnBody = z.object({ id: uuid, action: z.enum(RETURN_ACTIONS), note: z.string().trim().max(500).optional() })
const RETURN_VERB = { receive: 'Received', qc_pass: 'QC passed', qc_fail: 'QC failed' } as const

/** POST { id, action: receive | qc_pass | qc_fail, note? }. QC passed restocks once. */
export async function returnsActionPost(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  const parsed = ReturnBody.safeParse(await readJson(request))
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request')
  const { id, action, note } = parsed.data
  try {
    const r = await loadReturn(channel, id)
    if (!r) return bad('Return not found', 404)
    const conn = await adapterFor(channel)
    const outcome = await runChange(
      {
        channel,
        action: `return.${action}`,
        entityType: 'return',
        entityId: r.external_return_id,
        summary: `${RETURN_VERB[action]}: ${CHANNEL_LABEL[channel]} return ${r.external_return_id}${note ? ` (${note})` : ''}`,
        before: { status: r.status, restocked: r.restocked },
        validate: () => {
          const p = returnActionProblem(r, action)
          return p ? [p] : []
        },
        apply: () => applyReturnAction(r, action, note ?? null, conn?.adapter ?? null),
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok) return NextResponse.json({ error: outcome.problems.join(' '), problems: outcome.problems }, { status: 400 })
    return NextResponse.json({ ok: true, ...outcome.result })
  } catch (e) {
    return channelError(e)
  }
}
