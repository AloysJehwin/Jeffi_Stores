import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import { actorOf, channelError, readJson } from '@/lib/channels/route'
import { runChange } from '@/lib/channels/change-log'
import { getS3Url, putObjectBuffer } from '@/lib/shared/s3'
import { resolveMarketplaceCreds } from '@/lib/integrations/resolve'
import { fillTemplate, readTemplate, savedTemplateMappings, saveTemplateMapping, suggestTemplateColumns, TEMPLATE_FIELDS, validMapping, type TemplateMapping } from './catalog-export'
import { loadSellableUnits, parseUnitKey, type SellableUnit, type UnitListing } from './catalog-load'
import { buildImagePack, IMAGE_SPECS, MAX_PACK_IMAGES } from './images'
import { mappingProblems, matchSkuReport, recentListingTasks, saveListingMappings, submitUnits, suggestSkuColumns, type ListingTaskRow, type SkuReportField } from './listings'
import { getAdapter } from './registry'
import { importSettlementLines, loadChannelSettlements, mappingErrors, normalizeSettlementRows, fileRef, groupPayouts, saveSettlementMapping, savedSettlementMapping, suggestSettlementColumns, SETTLEMENT_FIELDS, type SettlementMapping } from './settlements'
import { cellText, readSheet } from './sheet'
import { loadInventory, pushMarketplaceStock, saveStockBuffer, stockSettings } from './stock'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Shared handlers behind /api/admin/{myntra,ajio}/{listings,stock,settlements}. Route files do the
// scope and plan gate; every write goes through runChange so it shows on the Changes tab.

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
const refused = (problems: string[], status = 400) => NextResponse.json({ error: problems.join(' ') || 'The change was rejected', problems }, { status })

async function upload(request: NextRequest): Promise<{ form: FormData; file: File | null; buf: Buffer | null } | NextResponse> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return bad('Send the file as a form upload.')
  }
  const f = form.get('file')
  if (!(f instanceof File) || !f.size) return { form, file: null, buf: null }
  if (f.size > MAX_UPLOAD_BYTES) return bad('The file is larger than 15 MB.', 413)
  return { form, file: f, buf: Buffer.from(await f.arrayBuffer()) }
}

const jsonField = <T>(form: FormData, key: string): T | null => {
  const v = form.get(key)
  if (typeof v !== 'string' || !v) return null
  try {
    return JSON.parse(v) as T
  } catch {
    return null
  }
}

const attachment = (body: Buffer, type: string, name: string) =>
  new NextResponse(new Uint8Array(body), { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } })

const stamp = () => new Date().toISOString().slice(0, 10)

// ── Listings ────────────────────────────────────────────────────────────────

export interface ListingUnitView {
  key: string
  level: SellableUnit['level']
  productId: string
  name: string
  variantName: string | null
  subVariantName: string | null
  ourSku: string | null
  size: string | null
  colour: string | null
  price: number | null
  mrp: number | null
  quantity: number | null
  image: string | null
  imageCount: number
  listing: UnitListing | null
}

export interface ListingsPayload {
  units: ListingUnitView[]
  tasks: ListingTaskRow[]
  submitSupported: boolean
  categories: string[]
  /** Attribute names across the catalogue, offered as template column sources. */
  attributeKeys: string[]
  imageSpec: { maxImages: number; publicUrls: boolean; maxPerPack: number }
}

async function submitSupported(channel: MarketplaceChannel): Promise<boolean> {
  const creds = await resolveMarketplaceCreds(channel).catch(() => null)
  return !!creds && typeof getAdapter(channel, creds).submitListings === 'function'
}

export async function listingsGet(channel: MarketplaceChannel): Promise<NextResponse> {
  try {
    const [units, tasks, supported, saved] = await Promise.all([loadSellableUnits(channel), recentListingTasks(channel), submitSupported(channel), savedTemplateMappings(channel)])
    const payload: ListingsPayload = {
      units: units.map(u => ({
        key: u.key,
        level: u.level,
        productId: u.productId,
        name: u.name,
        variantName: u.variantName,
        subVariantName: u.subVariantName,
        ourSku: u.ourSku,
        size: u.size,
        colour: u.colour,
        price: u.price,
        mrp: u.mrp,
        quantity: u.quantity,
        image: u.images[0] ?? null,
        imageCount: u.images.length,
        listing: u.listing,
      })),
      tasks,
      submitSupported: supported,
      categories: Object.keys(saved).sort(),
      attributeKeys: [...new Set(units.flatMap(u => Object.keys(u.attributes)))].sort().slice(0, 200),
      imageSpec: { maxImages: IMAGE_SPECS[channel].maxImages, publicUrls: IMAGE_SPECS[channel].publicUrls, maxPerPack: MAX_PACK_IMAGES },
    }
    return NextResponse.json(payload)
  } catch (e) {
    return channelError(e)
  }
}

const MappingRow = z.object({
  key: z.string().max(120),
  marketplaceSku: z.string().max(120).nullable(),
  styleId: z.string().max(120).nullable(),
  category: z.string().max(120).nullable().optional(),
  listedPrice: z.number().nullable().optional(),
  listedMrp: z.number().nullable().optional(),
})
const SaveBody = z.object({ rows: z.array(MappingRow).min(1).max(5000) })

async function saveRows(channel: MarketplaceChannel, admin: AdminJWTPayload, rows: z.infer<typeof MappingRow>[], summary: string): Promise<NextResponse> {
  const outcome = await runChange(
    {
      channel,
      action: 'listings.map',
      entityType: 'listing',
      summary,
      after: { rows: rows.length, sample: rows.slice(0, 5).map(r => ({ sku: r.marketplaceSku, style: r.styleId })) },
      validate: () => mappingProblems(channel, rows),
      apply: () => saveListingMappings(channel, rows),
    },
    actorOf(admin),
    false
  )
  if (!outcome.ok) return refused(outcome.problems)
  return NextResponse.json({ ok: true, saved: outcome.result?.saved ?? 0 })
}

/** PUT: save mappings typed in the table. */
export async function listingsSave(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const parsed = SaveBody.safeParse(await readJson(request))
    if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request')
    return await saveRows(channel, admin, parsed.data.rows, `Mapped ${parsed.data.rows.length} ${CHANNEL_LABEL[channel]} listing(s)`)
  } catch (e) {
    return channelError(e)
  }
}

/** POST ?action=report: a SKU report upload. Previews the matches; `apply=1` saves the changed ones. */
export async function listingsReport(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const up = await upload(request)
    if (up instanceof NextResponse) return up
    if (!up.buf) return bad('Choose the SKU report file.')
    const sheet = readSheet(up.buf)
    const columns = jsonField<Partial<Record<SkuReportField, string>>>(up.form, 'columns') ?? suggestSkuColumns(sheet.headers)
    const units = await loadSellableUnits(channel, { images: false })
    const { matches, unmatched } = matchSkuReport(units, sheet, columns)
    if (up.form.get('apply') !== '1') return NextResponse.json({ headers: sheet.headers, columns, matches, unmatched, rows: sheet.rows.length })
    const changed = matches.filter(m => m.change !== 'same')
    if (!changed.length) return NextResponse.json({ ok: true, saved: 0 })
    return await saveRows(
      channel,
      admin,
      changed.map(m => ({ key: m.key, marketplaceSku: m.marketplaceSku, styleId: m.styleId, listedPrice: m.listedPrice, listedMrp: m.listedMrp })),
      `Mapped ${changed.length} ${CHANNEL_LABEL[channel]} listing(s) from ${up.file?.name ?? 'a SKU report'}`
    )
  } catch (e) {
    return channelError(e)
  }
}

const KeysBody = z.object({ keys: z.array(z.string().max(120)).min(1).max(2000) })

async function unitsFor(channel: MarketplaceChannel, keys: string[], images = true): Promise<SellableUnit[]> {
  const parsed = keys.map(parseUnitKey).filter((k): k is NonNullable<typeof k> => !!k)
  const wanted = new Set(keys)
  const units = await loadSellableUnits(channel, { productIds: [...new Set(parsed.map(k => k.productId))], images })
  return units.filter(u => wanted.has(u.key))
}

/** POST ?action=inspect on export: the template's sheets, suggested columns and any saved mapping. */
export async function exportInspect(request: NextRequest, channel: MarketplaceChannel): Promise<NextResponse> {
  try {
    const up = await upload(request)
    if (up instanceof NextResponse) return up
    if (!up.buf) return bad('Choose the blank template from the portal.')
    const sheets = await readTemplate(up.buf)
    const category = String(up.form.get('category') ?? '').trim()
    const saved = category ? (await savedTemplateMappings(channel))[category] ?? null : null
    const attributeKeys = jsonField<string[]>(up.form, 'attributeKeys') ?? []
    return NextResponse.json({
      sheets: sheets.map(s => ({ ...s, suggested: suggestTemplateColumns(s.headers, attributeKeys) })),
      saved,
      fields: TEMPLATE_FIELDS,
    })
  } catch (e) {
    return channelError(e)
  }
}

/** POST on export: fills the template for the chosen units and saves the mapping for the category. */
export async function exportFill(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const up = await upload(request)
    if (up instanceof NextResponse) return up
    if (!up.buf) return bad('Choose the blank template from the portal.')
    const mapping = jsonField<TemplateMapping>(up.form, 'mapping')
    if (!validMapping(mapping)) return bad('The column mapping is not valid.')
    const keys = KeysBody.safeParse({ keys: jsonField<string[]>(up.form, 'keys') ?? [] })
    if (!keys.success) return bad('Pick the products to export.')
    const category = String(up.form.get('category') ?? '').trim()
    const units = await unitsFor(channel, keys.data.keys)
    if (!units.length) return bad('None of the picked products are sellable units.')
    const outcome = await runChange(
      {
        channel,
        action: 'listings.template_export',
        entityType: 'listing_template',
        entityId: category || null,
        summary: `Filled the ${CHANNEL_LABEL[channel]} ${category || ''} template for ${units.length} unit(s)`.replace(/\s+/g, ' '),
        after: { category, sheet: mapping.sheet, columns: Object.keys(mapping.columns).length },
        apply: async () => {
          const filled = await fillTemplate(up.buf!, units, mapping)
          if (category) await saveTemplateMapping(channel, category, mapping)
          return filled
        },
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok || !outcome.result) return refused(outcome.problems)
    const name = `${channel}-${(category || 'template').replace(/[^A-Za-z0-9_-]+/g, '-')}-${stamp()}.xlsx`
    const res = attachment(outcome.result.buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name)
    res.headers.set('X-Rows', String(outcome.result.rows))
    res.headers.set('X-Blank-Columns', encodeURIComponent(JSON.stringify(outcome.result.blanks)))
    return res
  } catch (e) {
    return channelError(e)
  }
}

/** POST on images: the zip of shaped photos for the chosen units. */
export async function imagesPack(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const parsed = KeysBody.safeParse(await readJson(request))
    if (!parsed.success) return bad('Pick the products for the image pack.')
    const units = await unitsFor(channel, parsed.data.keys)
    if (!units.length) return bad('None of the picked products are sellable units.')
    const outcome = await runChange(
      {
        channel,
        action: 'listings.image_pack',
        entityType: 'listing_images',
        summary: `Built a ${CHANNEL_LABEL[channel]} image pack for ${units.length} unit(s)`,
        apply: () =>
          buildImagePack(channel, units, {
            upload: async (key, body) => {
              await putObjectBuffer(key, body, 'image/jpeg')
              return getS3Url(key)
            },
          }),
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok || !outcome.result) return refused(outcome.problems)
    const p = outcome.result
    const res = attachment(p.zip, 'application/zip', `${channel}-images-${stamp()}.zip`)
    res.headers.set('X-Images', String(p.images))
    res.headers.set('X-Failed', String(p.failed.length))
    res.headers.set('X-Padded', String(p.padded))
    return res
  } catch (e) {
    return channelError(e)
  }
}

/** POST on submit: sends the chosen units through the marketplace API. */
export async function listingsSubmit(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const parsed = KeysBody.safeParse(await readJson(request))
    if (!parsed.success) return bad('Pick the listings to submit.')
    const creds = await resolveMarketplaceCreds(channel)
    if (!creds) return refused([`Connect ${CHANNEL_LABEL[channel]} first.`], 409)
    const adapter = getAdapter(channel, creds)
    const outcome = await runChange(
      {
        channel,
        action: 'listings.submit',
        entityType: 'listing',
        summary: `Submitted ${parsed.data.keys.length} ${CHANNEL_LABEL[channel]} listing(s) (${creds.mode})`,
        validate: () => (adapter.submitListings ? [] : [`${CHANNEL_LABEL[channel]} listing submission is not available yet. Use the template export.`]),
        apply: () => submitUnits(channel, adapter, creds, parsed.data.keys),
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok) return refused(outcome.problems)
    return NextResponse.json({ ok: true, ...outcome.result })
  } catch (e) {
    return channelError(e)
  }
}

export async function listingTasksGet(channel: MarketplaceChannel): Promise<NextResponse> {
  return NextResponse.json({ tasks: await recentListingTasks(channel) })
}

// ── Stock ───────────────────────────────────────────────────────────────────

export async function stockGet(channel: MarketplaceChannel): Promise<NextResponse> {
  try {
    return NextResponse.json(await loadInventory(channel))
  } catch (e) {
    return channelError(e)
  }
}

/** POST: push now. */
export async function stockPush(channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const outcome = await runChange(
      {
        channel,
        action: 'stock.push',
        entityType: 'inventory',
        summary: `Pushed stock to ${CHANNEL_LABEL[channel]}`,
        validate: async () => ((await resolveMarketplaceCreds(channel)) ? [] : [`Connect ${CHANNEL_LABEL[channel]} first.`]),
        apply: () => pushMarketplaceStock(channel),
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok) return refused(outcome.problems, 409)
    return NextResponse.json(outcome.result)
  } catch (e) {
    return channelError(e)
  }
}

/** PUT: the safety buffer held back from the marketplace. */
export async function stockSettingsPut(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const parsed = z.object({ buffer: z.number().int().min(0).max(1000) }).safeParse(await readJson(request))
    if (!parsed.success) return bad('The buffer is a whole number from 0 to 1000.')
    const before = await stockSettings(channel)
    const outcome = await runChange(
      {
        channel,
        action: 'stock.buffer',
        entityType: 'inventory',
        summary: `Set the ${CHANNEL_LABEL[channel]} stock buffer to ${parsed.data.buffer}`,
        before,
        after: parsed.data,
        apply: () => saveStockBuffer(channel, parsed.data.buffer),
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

// ── Settlements ─────────────────────────────────────────────────────────────

const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const daysBack = (n: number) => ({ from: new Date(Date.now() - (n - 1) * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })

export async function settlementsGet(request: NextRequest, channel: MarketplaceChannel): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams
    const from = sp.get('from')
    const to = sp.get('to')
    const range = isDay(from) && isDay(to) && from <= to ? { from, to } : daysBack(90)
    return NextResponse.json({ ...(await loadChannelSettlements(channel, range)), fields: SETTLEMENT_FIELDS })
  } catch (e) {
    return channelError(e)
  }
}

/** POST: a settlement report. Previews with the saved (or suggested) mapping; `commit=1` imports. */
export async function settlementsImport(request: NextRequest, channel: MarketplaceChannel, admin: AdminJWTPayload): Promise<NextResponse> {
  try {
    const up = await upload(request)
    if (up instanceof NextResponse) return up
    if (!up.buf) return bad('Choose the settlement report file.')
    const sheet = readSheet(up.buf)
    const mapping = jsonField<SettlementMapping>(up.form, 'mapping') ?? (await savedSettlementMapping(channel)) ?? suggestSettlementColumns(channel, sheet.headers)
    const problems = mappingErrors(mapping, sheet.headers)
    const { lines, errors } = problems.length ? { lines: [], errors: [] } : normalizeSettlementRows(sheet, mapping, fileRef(up.buf))
    if (up.form.get('commit') !== '1') {
      return NextResponse.json({
        fields: SETTLEMENT_FIELDS,
        headers: sheet.headers,
        mapping,
        problems,
        rows: sheet.rows.length,
        samples: Object.fromEntries(
          sheet.headers.map(h => [h, sheet.rows.slice(0, 50).map(r => cellText(r[h])).find(Boolean)?.slice(0, 60) ?? null]).filter(([, v]) => v != null)
        ),
        preview: lines.slice(0, 20).map(({ raw, ...l }) => l),
        errors: errors.slice(0, 20),
        payouts: groupPayouts(lines),
      })
    }
    if (problems.length) return refused(problems)
    if (!lines.length) return refused(['No settlement rows were found in this file.'])
    const fileName = up.file?.name ?? null
    const outcome = await runChange(
      {
        channel,
        action: 'settlements.import',
        entityType: 'settlement',
        summary: `Imported ${lines.length} ${CHANNEL_LABEL[channel]} settlement line(s) from ${fileName ?? 'a report'}`,
        after: { payouts: groupPayouts(lines).map(p => ({ ref: p.ref, net: p.net })).slice(0, 10) },
        apply: async () => {
          const r = await importSettlementLines(channel, lines, { fileName, source: 'upload' })
          await saveSettlementMapping(channel, mapping)
          return r
        },
      },
      actorOf(admin),
      false
    )
    if (!outcome.ok) return refused(outcome.problems)
    return NextResponse.json({ ok: true, ...outcome.result, errors: errors.length })
  } catch (e) {
    return channelError(e)
  }
}

