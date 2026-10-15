import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { isDigitalProduct } from '@/lib/catalog/digital-guard'
import { priceErrors, roundMoneyFields } from '@/lib/catalog/product-validation'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

const amount = z.union([z.number(), z.string(), z.null()]).optional()
const SubVariantFields = z
  .object({
    sub_variant_name: z.string().trim().min(1, 'Sub-variant name is required').max(255).optional(),
    sku: z.string().trim().max(100).nullable().optional(),
    price: amount,
    mrp: amount,
    price_ex_gst: amount,
    mrp_ex_gst: amount,
    cost_price: amount,
    discount_pct: amount,
    weight_grams: amount,
    length_cm: amount,
    breadth_cm: amount,
    height_cm: amount,
  })
  .passthrough()
const PostSchema = SubVariantFields.extend({
  sub_variant_name: z.string().trim().min(1, 'Sub-variant name is required').max(255),
})
const PatchSchema = SubVariantFields.extend({ id: z.string().min(1, 'Sub-variant id is required') })
const DeleteSchema = z.object({ id: z.string().min(1, 'Sub-variant id is required') })

class RouteError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

async function readBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object') throw new RouteError('Invalid JSON body', 400)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue.path.length ? `${issue.path.join('.')}: ` : ''
    throw new RouteError(`${where}${issue.message}`, 400)
  }
  return parsed.data
}

function priceCheck(sv: Record<string, any>) {
  const errs = priceErrors(`Sub-variant "${sv.sub_variant_name ?? ''}"`, {
    price: sv.price,
    mrp: sv.mrp,
    priceExGst: sv.price_ex_gst,
    mrpExGst: sv.mrp_ex_gst,
    cost: sv.cost_price,
    discountPct: sv.discount_pct,
  })
  if (errs.length > 0) throw new RouteError(errs[0], 400)
}

function nameClash(all: any[], variantId: string | null, name: unknown, exceptId?: string) {
  const n = String(name ?? '')
    .trim()
    .toLowerCase()
  if (!n) return
  const clash = all.find(
    (sv: any) =>
      !sv._cleared &&
      sv.variant_id === variantId &&
      sv.id !== exceptId &&
      String(sv.sub_variant_name ?? '')
        .trim()
        .toLowerCase() === n
  )
  if (clash) throw new RouteError(`A sub-variant named "${String(name).trim()}" already exists for this variant.`, 409)
}

function errorResponse(err: any, productId: string, action: string) {
  if (err instanceof RouteError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[draft-sub-variants] ${action} failed for`, productId, err)
  return NextResponse.json({ error: err?.message || `Failed to ${action} sub-variant` }, { status: 500 })
}

async function getAllDraftSubVariants(productId: string): Promise<any[]> {
  const row = await queryOne<{ sub_variants: any[] }>(`SELECT sub_variants FROM product_drafts WHERE product_id = $1`, [
    productId,
  ])
  return Array.isArray(row?.sub_variants) ? row!.sub_variants : []
}

// A variant is "touched" in the draft once it has ANY row (staged edit/add or a
// _cleared sentinel). The draft column is meant to be a COMPLETE snapshot per
// touched variant — not a sparse override list — so read-back and publish can
// treat it as authoritative. Seeding on first touch is what makes that true.
function variantTouched(all: any[], variantId: string): boolean {
  return all.some((sv: any) => sv.variant_id === variantId)
}

type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }

// Locked read-modify-write of product_drafts.sub_variants: concurrent add/edit/delete calls
// serialise on the draft row instead of overwriting each other's array.
async function mutateSubVariants<T>(
  productId: string,
  fn: (all: any[], client: Client) => Promise<{ next: any[]; result: T }>
): Promise<T> {
  return withTransaction(async client => {
    const r = await client.query(`SELECT sub_variants FROM product_drafts WHERE product_id = $1 FOR UPDATE`, [
      productId,
    ])
    if (!r.rows[0]) throw new RouteError('No draft exists for this product. Reload the edit page and try again.', 404)
    const all = Array.isArray(r.rows[0].sub_variants) ? r.rows[0].sub_variants : []
    const { next, result } = await fn(all, client)
    await client.query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
      productId,
      JSON.stringify(next),
    ])
    return result
  })
}

// On the first mutation of a variant in draft mode, copy its FULL live sub-variant
// set (created_at order) into the draft array so siblings aren't lost and order is
// stable. Live rows are tagged `_seeded` so publish knows the whole set is staged.
async function ensureVariantSeeded(client: Client, variantId: string, all: any[]): Promise<any[]> {
  if (variantTouched(all, variantId)) return all
  const live = (
    await client.query(`SELECT * FROM product_sub_variants WHERE variant_id = $1 ORDER BY created_at ASC`, [variantId])
  ).rows
  if (!live.length) return all
  return [...all, ...live.map(sv => ({ ...sv, _seeded: true }))]
}

async function gate(req: NextRequest, write: boolean) {
  const a = await authenticateAdmin(req)
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const allowed = write ? hasScope(a.role, a.scopes, 'products:write') : hasScope(a.role, a.scopes, 'products:read')
  return allowed ? null : NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
}

// GET — return the complete sub-variant set for a variant. If the variant has been
// touched in the draft, the draft holds the full snapshot (seeded on first edit);
// otherwise fall back to the live rows.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const denied = await gate(req, false)
  if (denied) return denied

  const variantId = req.nextUrl.searchParams.get('variant_id')
  if (!variantId) return NextResponse.json({ error: 'variant_id required' }, { status: 400 })

  try {
    const all = await getAllDraftSubVariants(id)
    if (!variantTouched(all, variantId)) {
      const live = await queryMany(`SELECT * FROM product_sub_variants WHERE variant_id = $1 ORDER BY created_at ASC`, [
        variantId,
      ])
      return NextResponse.json({ sub_variants: live })
    }
    // Touched → the draft is the complete snapshot for this variant.
    return NextResponse.json({ sub_variants: all.filter((sv: any) => !sv._cleared && sv.variant_id === variantId) })
  } catch (err) {
    return errorResponse(err, id, 'load')
  }
}

// POST — add a sub-variant. Seed the variant's full set first so the draft stays
// a complete snapshot, then append the new draft row.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const denied = await gate(req, true)
  if (denied) return denied

  try {
    const variantId = req.nextUrl.searchParams.get('variant_id')
    if (!variantId) throw new RouteError('variant_id required', 400)
    if (await isDigitalProduct(id)) throw new RouteError('Digital products cannot have variants', 409)
    const body = await readBody(req, PostSchema)
    priceCheck(body)

    const newSv = await mutateSubVariants(id, async (stored, client) => {
      const all = await ensureVariantSeeded(client, variantId, stored)
      nameClash(all, variantId, body.sub_variant_name)
      const sv = {
        ...roundMoneyFields(body),
        id: `draft-sv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        variant_id: variantId,
      }
      return { next: [...all, sv], result: sv }
    })
    return NextResponse.json({ sub_variant: newSv }, { status: 201 })
  } catch (err) {
    return errorResponse(err, id, 'add')
  }
}

// DELETE — remove a sub-variant. Seed first so siblings survive, then drop the row
// (live rows also leave a _cleared sentinel so publish deletes them).
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const denied = await gate(req, true)
  if (denied) return denied

  try {
    const variantId = req.nextUrl.searchParams.get('variant_id')
    const { id: svId } = await readBody(req, DeleteSchema)
    await mutateSubVariants(id, async (stored, client) => {
      const all = variantId ? await ensureVariantSeeded(client, variantId, stored) : stored
      const filtered = all.filter((sv: any) => sv.id !== svId)
      // Live sub-variants (real UUID ids) get a cleared sentinel so publish deletes them;
      // draft-sv- rows are just dropped.
      if (!String(svId).startsWith('draft-sv-')) {
        filtered.push({ _cleared: true, id: `cleared-sv-${Date.now()}`, variant_id: variantId, original_id: svId })
      }
      return { next: filtered, result: null }
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, id, 'delete')
  }
}

// PATCH — edit a sub-variant. Seed first so the row is present, then update it in
// place by id (never append a lone live row again).
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const denied = await gate(req, true)
  if (denied) return denied

  try {
    const variantId = req.nextUrl.searchParams.get('variant_id')
    const body = await readBody(req, PatchSchema)
    const { id: svId, ...updates } = roundMoneyFields(body)

    const result = await mutateSubVariants(id, async (stored, client) => {
      const all = variantId ? await ensureVariantSeeded(client, variantId, stored) : stored
      const existing = all.find((sv: any) => sv.id === svId)
      priceCheck({ ...(existing || {}), ...updates })
      if (updates.sub_variant_name !== undefined)
        nameClash(all, existing?.variant_id ?? variantId, updates.sub_variant_name, svId)
      // Merge onto the existing row and mark it edited so publish reliably detects a change;
      // a row not found even after seeding (a brand-new client id) is added.
      const next = existing
        ? all.map((sv: any) => (sv.id === svId ? { ...sv, ...updates, _edited: true } : sv))
        : [...all, { ...body, variant_id: variantId, _edited: true }]
      return { next, result: next.find((sv: any) => sv.id === svId) }
    })
    return NextResponse.json({ sub_variant: result })
  } catch (err) {
    return errorResponse(err, id, 'update')
  }
}
