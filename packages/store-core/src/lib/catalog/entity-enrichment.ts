// AI proposals for brand / category profile fields (docs/BRAND_CATEGORY_PLAN.md §3.4). The model only
// fills empty fields; an admin approves each field, and approval writes live with a revision.
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { aiChat } from '@/lib/shared/ai-client'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { recordDirectRevision } from '@/lib/admin/entity-revisions'
import { BRAND_PROFILE_FIELDS } from './brand-fields'
import { CATEGORY_PROFILE_FIELDS } from './category-fields'
import { parseField, type FieldSpec } from './entity-fields'
import { applyBrandProfile, brandContentOf } from './brand-draft'
import { applyCategoryProfile, categoryContentOf } from './category-draft'

export type EnrichEntity = 'brand' | 'category'
/** draft = written copy; suggest = a fact the admin must check (unticked by default in the review). */
export type EnrichRole = 'draft' | 'suggest'

export const ENTITY_AI_FIELDS: Record<EnrichEntity, Record<string, EnrichRole>> = {
  brand: {
    tagline: 'draft',
    story: 'draft',
    meta_title: 'draft',
    meta_description: 'draft',
    seo_content: 'draft',
    legal_name: 'suggest',
    aliases: 'suggest',
    country_of_origin: 'suggest',
    founded_year: 'suggest',
    headquarters: 'suggest',
    social_links: 'suggest',
    service_url: 'suggest',
    default_warranty_months: 'suggest',
    warranty_terms: 'suggest',
  },
  category: {
    tagline: 'draft',
    short_name: 'draft',
    meta_title: 'draft',
    meta_description: 'draft',
    seo_content: 'draft',
    product_title_template: 'draft',
    default_hsn_code: 'suggest',
    default_gst_rate: 'suggest',
    default_uqc: 'suggest',
  },
}

const SPECS: Record<EnrichEntity, FieldSpec[]> = { brand: BRAND_PROFILE_FIELDS, category: CATEGORY_PROFILE_FIELDS }
export const specFor = (type: EnrichEntity, key: string) => SPECS[type].find(s => s.key === key)

const empty = (v: unknown) =>
  v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)

interface EntitySource {
  row: Record<string, any>
  context: Record<string, unknown>
}

async function loadSource(type: EnrichEntity, id: string): Promise<EntitySource | null> {
  if (type === 'brand') {
    const row = await queryOne<Record<string, any>>('SELECT * FROM brands WHERE id = $1', [id])
    if (!row) return null
    const products = await queryMany<{ name: string; category: string | null }>(
      `SELECT p.name, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.brand_id = $1 AND p.is_active ORDER BY p.sales_count DESC NULLS LAST LIMIT 15`,
      [id]
    )
    return {
      row,
      context: {
        name: row.name,
        website: row.website,
        description: row.description,
        products: products.map(p => p.name),
        categories: [...new Set(products.map(p => p.category).filter(Boolean))],
      },
    }
  }
  const row = await queryOne<Record<string, any>>(
    `SELECT c.*, pc.name AS parent_name FROM categories c LEFT JOIN categories pc ON pc.id = c.parent_category_id WHERE c.id = $1`,
    [id]
  )
  if (!row) return null
  const [products, hsn, specKeys] = await Promise.all([
    queryMany<{ name: string }>(
      `SELECT name FROM products WHERE category_id = $1 AND is_active ORDER BY sales_count DESC NULLS LAST LIMIT 15`,
      [id]
    ),
    queryMany<{ hsn: string; gst: string; n: number }>(
      `SELECT hsn_code AS hsn, gst_percentage::text AS gst, count(*)::int AS n FROM products
        WHERE category_id = $1 AND NULLIF(hsn_code, '') IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5`,
      [id]
    ),
    queryMany<{ k: string }>(
      `SELECT k FROM products p, jsonb_object_keys(CASE WHEN jsonb_typeof(p.specifications) = 'object' THEN p.specifications ELSE '{}' END) k
        WHERE p.category_id = $1 GROUP BY k ORDER BY count(*) DESC LIMIT 12`,
      [id]
    ),
  ])
  return {
    row,
    context: {
      name: row.name,
      parent: row.parent_name,
      description: row.description,
      google_category: row.google_product_category,
      products: products.map(p => p.name),
      product_hsn_and_gst: hsn,
      spec_keys: specKeys.map(s => s.k),
    },
  }
}

function buildPrompt(type: EnrichEntity, src: EntitySource, keys: string[], wantFaqs: boolean): string {
  const fields = keys.map(k => {
    const s = specFor(type, k)!
    const extra = s.kind === 'links' ? ` (object with keys ${s.subkeys?.join(', ')})` : s.kind === 'list' ? ' (array of strings)' : s.max ? ` (max ${s.max} chars)` : ''
    return `- ${k}: ${s.label}${extra}${s.hint ? `. ${s.hint}` : ''}`
  })
  return [
    `Fill missing profile fields for this ${type} of an Indian online store. Context (JSON):`,
    JSON.stringify(src.context),
    '',
    'Fields you may fill:',
    ...fields,
    wantFaqs ? '- faqs: 3 to 5 buying-guide questions shoppers ask about this category, as [{"question","answer"}]' : '',
    '',
    'Rules: return one JSON object with only the fields you are confident about; leave a field out rather than guess.',
    'Facts (legal name, founding year, headquarters, origin, links, warranty, HSN, GST) must be ones you know to be true; if unsure, omit them.',
    'country_of_origin is a two-letter ISO code. default_hsn_code is 4 to 8 digits; default_gst_rate is a number (0, 5, 12, 18 or 28).',
    'Write in plain English, no marketing superlatives, no HTML or markdown. Add "sources": {field: "why you believe it"} for each fact field.',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface EnrichContext {
  system: string
  cacheNamespace: string
}

/** Resolve inside the request: a detached job has no request context for the tenant or store name. */
export async function entityEnrichmentContext(): Promise<EnrichContext> {
  const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
  return {
    system: `You write accurate catalogue data for ${await storeDescriptorForPrompt()}.`,
    cacheNamespace: (await resolveTenantId()) ?? 'platform',
  }
}

/** Asks the model for the entity's empty AI fields and stores a proposal. Returns the log id, or null when nothing to fill. */
export async function proposeEntityEnrichment(type: EnrichEntity, id: string, ctx?: EnrichContext): Promise<string | null> {
  const src = await loadSource(type, id)
  if (!src) return null
  const keys = Object.keys(ENTITY_AI_FIELDS[type]).filter(k => specFor(type, k) && empty(src.row[k]))
  let wantFaqs = false
  if (type === 'category') {
    const n = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM category_faqs WHERE category_id = $1', [id])
    wantFaqs = !n?.n
  }
  if (!keys.length && !wantFaqs) return null

  const { system, cacheNamespace } = ctx ?? (await entityEnrichmentContext())
  const r = await aiChat({
    feature: 'enrichment',
    cacheNamespace,
    modelHint: 'copy',
    jsonMode: true,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildPrompt(type, src, keys, wantFaqs) },
    ],
  })
  let raw: Record<string, any> = {}
  try {
    raw = JSON.parse(r.content)
  } catch {
    raw = {}
  }
  const fields: Record<string, unknown> = {}
  for (const k of keys) {
    const v = k in raw ? parseField(specFor(type, k)!, raw[k]) : null
    if (!empty(v)) fields[k] = v
  }
  const faqs = wantFaqs && Array.isArray(raw.faqs)
    ? raw.faqs
        .filter((f: any) => f && typeof f.question === 'string' && typeof f.answer === 'string')
        .slice(0, 6)
        .map((f: any) => ({ question: f.question.trim().slice(0, 300), answer: f.answer.trim().slice(0, 2000) }))
    : []
  const sources = raw.sources && typeof raw.sources === 'object' ? raw.sources : {}
  const ok = Object.keys(fields).length > 0 || faqs.length > 0
  const row = await queryOne<{ id: string }>(
    `INSERT INTO entity_ai_enrichment_log (entity_type, entity_id, fields, faqs, sources, model, status, error)
     VALUES ($1, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8) RETURNING id::text`,
    [type, id, JSON.stringify(fields), faqs.length ? JSON.stringify(faqs) : null, JSON.stringify(sources), r.model, ok ? 'proposed' : 'failed', ok ? null : 'Nothing confident to propose']
  )
  return row?.id ?? null
}

/** Applies the chosen fields (default: all) of a proposal to the live row, recording a revision. */
export async function approveEntityEnrichment(logId: string, opts: { fields?: string[]; faqs?: boolean; adminId?: string | null }) {
  const log = await queryOne<{ entity_type: EnrichEntity; entity_id: string; fields: Record<string, unknown>; faqs: any[] | null; status: string }>(
    `SELECT entity_type, entity_id::text, fields, faqs, status FROM entity_ai_enrichment_log WHERE id = $1`,
    [logId]
  )
  if (!log || log.status !== 'proposed') return { ok: false as const, error: 'Proposal not found or already decided' }
  const type = log.entity_type
  const table = type === 'brand' ? 'brands' : 'categories'
  const chosen = Object.fromEntries(
    Object.entries(log.fields ?? {}).filter(([k]) => (opts.fields ? opts.fields.includes(k) : true) && ENTITY_AI_FIELDS[type][k])
  )
  const db = { query: (t: string, p?: unknown[]) => query(t, p) } as any
  const before = await queryOne<Record<string, any>>(`SELECT * FROM ${table} WHERE id = $1`, [log.entity_id])
  if (!before) return { ok: false as const, error: `${type} not found` }
  // Never overwrite a value an admin set after the proposal was made.
  for (const k of Object.keys(chosen)) if (!empty(before[k])) delete chosen[k]
  if (Object.keys(chosen).length) {
    if (type === 'brand') await applyBrandProfile(db, log.entity_id, chosen)
    else await applyCategoryProfile(db, log.entity_id, chosen)
    const after = await queryOne<Record<string, any>>(`SELECT * FROM ${table} WHERE id = $1`, [log.entity_id])
    const contentOf = type === 'brand' ? brandContentOf : categoryContentOf
    if (after) await recordDirectRevision({ type, id: log.entity_id, before: contentOf(before), after: contentOf(after), actorAdminId: opts.adminId ?? null })
  }
  let faqsAdded = 0
  if (type === 'category' && opts.faqs !== false && log.faqs?.length) {
    const has = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM category_faqs WHERE category_id = $1', [log.entity_id])
    if (!has?.n) {
      for (const [i, f] of log.faqs.entries()) {
        await query(`INSERT INTO category_faqs (category_id, question, answer, sort_order) VALUES ($1, $2, $3, $4)`, [log.entity_id, f.question, f.answer, i])
        faqsAdded++
      }
    }
  }
  await query(
    `UPDATE entity_ai_enrichment_log SET status = 'approved', decided_at = now(), decided_by_admin_id = $2, applied_fields = $3 WHERE id = $1`,
    [logId, opts.adminId ?? null, Object.keys(chosen)]
  )
  return { ok: true as const, applied: Object.keys(chosen), faqsAdded }
}

/**
 * Background proposal after an admin creates a brand or category. Gated on catalog_enrichment:write,
 * which the session holds only when the role and the tenant's plan include AI.
 */
export async function triggerEntityEnrichment(type: EnrichEntity, id: string) {
  try {
    const { getAdminSession } = await import('@/lib/auth/admin-auth')
    const { hasScope } = await import('@/lib/auth/scopes')
    const session = await getAdminSession()
    if (!session || !hasScope(session.role, session.scopes, 'catalog_enrichment:write')) return
    const ctx = await entityEnrichmentContext()
    void proposeEntityEnrichment(type, id, ctx).catch(err => console.error('[entity-enrichment] create trigger failed', type, id, err))
  } catch (err) {
    console.error('[entity-enrichment] create trigger skipped', err)
  }
}

export async function rejectEntityEnrichment(logId: string, adminId?: string | null) {
  await query(
    `UPDATE entity_ai_enrichment_log SET status = 'rejected', decided_at = now(), decided_by_admin_id = $2 WHERE id = $1 AND status = 'proposed'`,
    [logId, adminId ?? null]
  )
}

/** Entities with at least one empty AI field and no open or recent proposal. */
export async function entitiesNeedingEnrichment(type: EnrichEntity, limit = 100): Promise<string[]> {
  const table = type === 'brand' ? 'brands' : 'categories'
  const textKeys = Object.keys(ENTITY_AI_FIELDS[type]).filter(k => {
    const kind = specFor(type, k)?.kind
    return kind && !['list', 'links', 'int', 'decimal'].includes(kind)
  })
  const rows = await queryMany<{ id: string }>(
    `SELECT t.id::text FROM ${table} t
      WHERE t.is_active AND NOT t.is_draft
        AND (${textKeys.map(k => `NULLIF(t.${k}::text, '') IS NULL`).join(' OR ')})
        AND NOT EXISTS (SELECT 1 FROM entity_ai_enrichment_log l
                         WHERE l.entity_type = $1 AND l.entity_id = t.id
                           AND (l.status = 'proposed' OR l.proposed_at > now() - interval '30 days'))
      ORDER BY t.name LIMIT $2`,
    [type, limit]
  )
  return rows.map(r => r.id)
}
