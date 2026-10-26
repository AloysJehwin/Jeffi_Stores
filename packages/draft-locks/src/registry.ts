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

/** The homepage draft is a singleton row; its lock uses the nil uuid. */
export const HOMEPAGE_LOCK_ID = '00000000-0000-0000-0000-000000000000'

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

const catalogDraft = (draftTable: string, key: string, entity: string, nameCol: string, path: string, writeScope: string) => ({
  existsSql: `SELECT 1 FROM ${draftTable} WHERE ${key} = $1 UNION ALL SELECT 1 FROM ${entity} WHERE id = $1 AND is_draft LIMIT 1`,
  listSql: `SELECT ${key} AS id, updated_at FROM ${draftTable}
            UNION SELECT id, created_at FROM ${entity} WHERE is_draft
              AND NOT EXISTS (SELECT 1 FROM ${draftTable} d WHERE d.${key} = ${entity}.id)`,
  labelSql: `SELECT id, ${nameCol}::text AS label, NULL::text AS ref FROM ${entity} WHERE id = ANY($1::uuid[])`,
  editHref: (id: string) => `/admin/${path}/${id}/edit`,
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
    existsSql: `SELECT 1 FROM supplier_drafts WHERE supplier_id = $1`,
    listSql: `SELECT supplier_id AS id, updated_at FROM supplier_drafts`,
    labelSql: `SELECT id, name::text AS label, NULL::text AS ref FROM suppliers WHERE id = ANY($1::uuid[])`,
    editHref: id => `/admin/suppliers/${id}/edit`,
  },
  offer: {
    label: 'Offer',
    writeScope: 'coupons:write',
    readScope: 'coupons:read',
    existsSql: `SELECT 1 FROM offer_drafts WHERE offer_id = $1`,
    listSql: `SELECT offer_id AS id, updated_at FROM offer_drafts`,
    labelSql: `SELECT id, title::text AS label, NULL::text AS ref FROM product_offers WHERE id = ANY($1::uuid[])`,
    editHref: id => `/admin/offers/${id}/edit`,
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
    existsSql: `SELECT 1 FROM homepage_drafts WHERE id = true`,
    listSql: `SELECT '${HOMEPAGE_LOCK_ID}'::uuid AS id, updated_at FROM homepage_drafts WHERE id = true`,
    labelSql: `SELECT '${HOMEPAGE_LOCK_ID}'::uuid AS id, 'Homepage'::text AS label, NULL::text AS ref`,
    hintSql: `SELECT updated_by AS admin_id FROM homepage_drafts WHERE id = true`,
    editHref: () => `/admin/settings/homepage`,
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
}

export const DRAFT_RESOURCE_TYPES = Object.keys(DRAFT_RESOURCES) as DraftResourceType[]

export function isDraftResourceType(v: unknown): v is DraftResourceType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DRAFT_RESOURCES, v)
}

/** administrator / super_admin may force a takeover (same set as isPlatformOwner). */
export function isLockOverrideRole(role: string | null | undefined): boolean {
  return role === 'administrator' || role === 'super_admin'
}
