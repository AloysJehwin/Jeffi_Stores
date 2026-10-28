// Which drafts can be locked, how to tell one exists, and who probably started it.
// SQL params: existsSql/hintSql take $1 = resource id; labelSql takes $1 = uuid[];
// listSql returns every current draft of the type as (id, updated_at).

export type DraftResourceType =
  | 'product'
  | 'brand'
  | 'category'
  | 'coupon'
  | 'review_form'
  | 'supplier'
  | 'offer'
  | 'campaign'
  | 'homepage'
  | 'mailer'
  | 'invoice'
  | 'quotation'
  | 'purchase_order'
  | 'po_new'
  | 'po_receive'
  | 'cash_sale'
  | 'scenario'
  | 'google_ads_campaign'
  | 'rfq_reply'

/** The homepage is one entity with no row of its own; its drafts and revisions use the nil uuid. */
export const HOMEPAGE_ENTITY_ID = '00000000-0000-0000-0000-000000000000'

export interface DraftResourceDef {
  label: string
  writeScope: string
  readScope: string
  existsSql: string
  listSql: string
  labelSql: string
  hintSql?: string
  editHref: (id: string, ref?: string | null) => string
}

// Edit drafts are branches (their own id, several per entity); a never-published entity
// (is_draft) is its own create-draft, locked by the entity id. `ref` carries the entity id.
const branchSql = (draftTable: string, key: string, entity: string, nameCol: string) => ({
  labelSql: `SELECT d.id, (e.${nameCol} || COALESCE(' · ' || NULLIF(d.title, ''), ''))::text AS label, d.${key}::text AS ref
               FROM ${draftTable} d JOIN ${entity} e ON e.id = d.${key} WHERE d.id = ANY($1::uuid[])`,
  hintSql: `SELECT author_admin_id AS admin_id FROM ${draftTable} WHERE id = $1`,
})
const branchHref = (path: string) => (id: string, ref?: string | null) =>
  ref && ref !== id ? `/admin/${path}/${ref}/edit?draft=${id}` : `/admin/${path}/${id}/edit`

const catalogDraft = (draftTable: string, key: string, entity: string, nameCol: string, path: string, writeScope: string) => ({
  existsSql: `SELECT 1 FROM ${draftTable} WHERE id = $1 UNION ALL SELECT 1 FROM ${entity} WHERE id = $1 AND is_draft LIMIT 1`,
  listSql: `SELECT id, updated_at FROM ${draftTable}
            UNION SELECT id, created_at FROM ${entity} WHERE is_draft
              AND NOT EXISTS (SELECT 1 FROM ${draftTable} d WHERE d.${key} = ${entity}.id)`,
  labelSql: `${branchSql(draftTable, key, entity, nameCol).labelSql}
             UNION ALL SELECT id, ${nameCol}::text AS label, id::text AS ref FROM ${entity} WHERE id = ANY($1::uuid[])`,
  hintSql: branchSql(draftTable, key, entity, nameCol).hintSql,
  editHref: branchHref(path),
  writeScope,
  readScope: writeScope.replace(':write', ':read'),
})

export const DRAFT_RESOURCES: Record<DraftResourceType, DraftResourceDef> = {
  product: { label: 'Product', ...catalogDraft('product_drafts', 'product_id', 'products', 'name', 'products', 'products:write') },
  brand: { label: 'Brand', ...catalogDraft('brand_drafts', 'brand_id', 'brands', 'name', 'brands', 'brands:write') },
  category: {
    label: 'Category',
    ...catalogDraft('category_drafts', 'category_id', 'categories', 'name', 'categories', 'categories:write'),
  },
  coupon: { label: 'Coupon', ...catalogDraft('coupon_drafts', 'coupon_id', 'coupons', 'code', 'coupons', 'coupons:write') },
  review_form: {
    label: 'Review form',
    ...catalogDraft('review_form_drafts', 'form_id', 'review_forms', 'title', 'review-forms', 'review_forms:write'),
  },
  supplier: {
    label: 'Supplier',
    writeScope: 'inventory:write',
    readScope: 'inventory:read',
    existsSql: `SELECT 1 FROM supplier_drafts WHERE id = $1`,
    listSql: `SELECT id, updated_at FROM supplier_drafts`,
    ...branchSql('supplier_drafts', 'supplier_id', 'suppliers', 'name'),
    editHref: branchHref('suppliers'),
  },
  offer: {
    label: 'Offer',
    writeScope: 'coupons:write',
    readScope: 'coupons:read',
    existsSql: `SELECT 1 FROM offer_drafts WHERE id = $1`,
    listSql: `SELECT id, updated_at FROM offer_drafts`,
    ...branchSql('offer_drafts', 'offer_id', 'product_offers', 'title'),
    editHref: branchHref('offers'),
  },
  campaign: {
    label: 'Campaign',
    writeScope: 'campaigns:write',
    readScope: 'campaigns:read',
    // The empty row the GET creates is not a draft.
    existsSql: `SELECT 1 FROM campaign_drafts WHERE campaign_id = $1 AND fields <> '{}'::jsonb`,
    listSql: `SELECT campaign_id AS id, updated_at FROM campaign_drafts WHERE fields <> '{}'::jsonb`,
    labelSql: `SELECT d.campaign_id AS id, COALESCE(c.name, d.kind)::text AS label, d.kind::text AS ref
                 FROM campaign_drafts d LEFT JOIN campaigns c ON c.kind = d.kind WHERE d.campaign_id = ANY($1::uuid[])`,
    editHref: (_id, kind) => `/admin/campaigns/${kind ?? ''}/edit`,
  },
  homepage: {
    label: 'Homepage',
    writeScope: 'settings:write',
    readScope: 'settings:read',
    existsSql: `SELECT 1 FROM homepage_draft_branches WHERE id = $1`,
    listSql: `SELECT id, updated_at FROM homepage_draft_branches`,
    labelSql: `SELECT id, ('Homepage' || COALESCE(' · ' || NULLIF(title, ''), ''))::text AS label, NULL::text AS ref
                 FROM homepage_draft_branches WHERE id = ANY($1::uuid[])`,
    hintSql: `SELECT author_admin_id AS admin_id FROM homepage_draft_branches WHERE id = $1`,
    editHref: id => `/admin/settings/homepage?draft=${id}`,
  },
  mailer: {
    label: 'Message',
    writeScope: 'mailer:write',
    readScope: 'mailer:read',
    existsSql: `SELECT 1 FROM email_campaigns WHERE id = $1 AND status = 'draft'`,
    listSql: `SELECT id, updated_at FROM email_campaigns WHERE status = 'draft'`,
    labelSql: `SELECT id, title::text AS label, NULL::text AS ref FROM email_campaigns WHERE id = ANY($1::uuid[])`,
    hintSql: `SELECT created_by AS admin_id FROM email_campaigns WHERE id = $1`,
    editHref: id => `/admin/marketing/messaging/new?draftId=${id}`,
  },
  invoice: {
    label: 'Invoice',
    writeScope: 'invoices:write',
    readScope: 'invoices:read',
    existsSql: `SELECT 1 FROM orders WHERE id = $1 AND status = 'draft'`,
    listSql: `SELECT id, updated_at FROM orders WHERE status = 'draft' AND source IS DISTINCT FROM 'cash_sale'`,
    labelSql: `SELECT id, COALESCE(NULLIF(customer_name, ''), order_number)::text AS label, NULL::text AS ref
                 FROM orders WHERE id = ANY($1::uuid[])`,
    editHref: id => `/admin/invoices?view=edit&edit=${id}`,
  },
  quotation: {
    label: 'Quotation',
    writeScope: 'quotations:write',
    readScope: 'quotations:read',
    existsSql: `SELECT 1 FROM quotations WHERE id = $1 AND status = 'draft'`,
    listSql: `SELECT id, updated_at FROM quotations WHERE status = 'draft'`,
    labelSql: `SELECT id, quote_number::text AS label, NULL::text AS ref FROM quotations WHERE id = ANY($1::uuid[])`,
    hintSql: `SELECT created_by AS admin_id FROM quotations WHERE id = $1`,
    editHref: id => `/admin/quotations/${id}/view`,
  },
  purchase_order: {
    label: 'Purchase order',
    writeScope: 'inventory:write',
    readScope: 'inventory:read',
    existsSql: `SELECT 1 FROM purchase_orders WHERE id = $1 AND status = 'draft'`,
    listSql: `SELECT id, updated_at FROM purchase_orders WHERE status = 'draft'`,
    labelSql: `SELECT id, po_number::text AS label, NULL::text AS ref FROM purchase_orders WHERE id = ANY($1::uuid[])`,
    editHref: id => `/admin/purchase-orders?po=${id}`,
  },
  po_new: {
    label: 'New purchase order',
    writeScope: 'inventory:write',
    readScope: 'inventory:read',
    existsSql: `SELECT 1 FROM po_drafts WHERE id = $1 AND promoted_po_id IS NULL`,
    listSql: `SELECT id, updated_at FROM po_drafts WHERE promoted_po_id IS NULL`,
    labelSql: `SELECT d.id, COALESCE('New PO · ' || s.name, 'New purchase order')::text AS label, NULL::text AS ref
                 FROM po_drafts d LEFT JOIN suppliers s ON s.id = d.supplier_id WHERE d.id = ANY($1::uuid[])`,
    hintSql: `SELECT admin_id FROM po_drafts WHERE id = $1`,
    editHref: id => `/admin/purchase-orders/new?draftId=${id}`,
  },
  po_receive: {
    label: 'PO receipt',
    writeScope: 'inventory:write',
    readScope: 'inventory:read',
    existsSql: `SELECT 1 FROM po_receive_drafts WHERE po_id = $1`,
    listSql: `SELECT po_id AS id, updated_at FROM po_receive_drafts`,
    labelSql: `SELECT id, ('Receive ' || po_number)::text AS label, NULL::text AS ref FROM purchase_orders WHERE id = ANY($1::uuid[])`,
    hintSql: `SELECT admin_id FROM po_receive_drafts WHERE po_id = $1`,
    editHref: id => `/admin/purchase-orders?po=${id}`,
  },
  cash_sale: {
    label: 'Held bill',
    writeScope: 'invoices:write',
    readScope: 'invoices:read',
    existsSql: `SELECT 1 FROM cash_sale_drafts WHERE id = $1`,
    listSql: `SELECT id, updated_at FROM cash_sale_drafts`,
    labelSql: `SELECT id, (COALESCE(NULLIF(label, ''), 'Held bill') || ' · ' || jsonb_array_length(items) || ' item(s)')::text AS label, NULL::text AS ref
                 FROM cash_sale_drafts WHERE id = ANY($1::uuid[])`,
    hintSql: `SELECT admin_id FROM cash_sale_drafts WHERE id = $1`,
    editHref: id => `/admin/cash-sale?draft=${id}`,
  },
  scenario: {
    label: 'Scenario',
    writeScope: 'campaigns:write',
    readScope: 'campaigns:read',
    existsSql: `SELECT 1 FROM scenario_drafts WHERE id = $1`,
    listSql: `SELECT id, updated_at FROM scenario_drafts`,
    labelSql: `SELECT id, ('New scenario · ' || COALESCE(NULLIF(title, ''), NULLIF(fields->>'name', ''), 'untitled'))::text AS label, NULL::text AS ref
                 FROM scenario_drafts WHERE id = ANY($1::uuid[])`,
    hintSql: `SELECT admin_id FROM scenario_drafts WHERE id = $1`,
    editHref: id => `/admin/campaigns/scenarios/new?draft=${id}`,
  },
  google_ads_campaign: {
    label: 'Google Ads campaign',
    writeScope: 'google_ads_campaigns:write',
    readScope: 'google_ads:read',
    existsSql: `SELECT 1 FROM ads_campaign_drafts WHERE id = $1`,
    listSql: `SELECT id, updated_at FROM ads_campaign_drafts`,
    labelSql: `SELECT id, ('New campaign · ' || COALESCE(NULLIF(title, ''), NULLIF(fields->'draft'->>'name', ''), 'untitled'))::text AS label, NULL::text AS ref
                 FROM ads_campaign_drafts WHERE id = ANY($1::uuid[])`,
    hintSql: `SELECT admin_id FROM ads_campaign_drafts WHERE id = $1`,
    editHref: id => `/admin/google-ads?tab=drafts&draft=${id}`,
  },
  rfq_reply: {
    label: 'RFQ reply',
    writeScope: 'business_rfqs:write',
    readScope: 'business_rfqs:read',
    existsSql: `SELECT 1 FROM rfq_reply_drafts WHERE id = $1`,
    listSql: `SELECT id, updated_at FROM rfq_reply_drafts`,
    labelSql: `SELECT d.id, ('Reply · ' || r.rfq_number)::text AS label, d.rfq_id::text AS ref
                 FROM rfq_reply_drafts d JOIN business_rfqs r ON r.id = d.rfq_id WHERE d.id = ANY($1::uuid[])`,
    hintSql: `SELECT admin_id FROM rfq_reply_drafts WHERE id = $1`,
    editHref: (id, ref) => `/admin/business/rfqs/${ref ?? ''}`,
  },
}

export const DRAFT_RESOURCE_TYPES = Object.keys(DRAFT_RESOURCES) as DraftResourceType[]

export function isDraftResourceType(v: unknown): v is DraftResourceType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DRAFT_RESOURCES, v)
}

/** administrator / super_admin may force a takeover (same set as isPlatformOwner). */
export function isLockOverrideRole(role: string | null | undefined): boolean {
  return role === 'administrator' || role === 'super_admin'
}
