import { controlPlanePool } from './shared'
import type { TenantRow } from './tenants'

export interface Owner {
  id: string
  email: string
  name: string | null
  created_at: string
}

/** Upsert an owner by email (used by OTP/Google owner auth — verification already done). */
export async function findOrCreateOwner(email: string, name: string | null): Promise<Owner> {
  const pool = controlPlanePool()
  const existing = await pool.query(`SELECT id, email, name, created_at FROM owners WHERE email=$1`, [email])
  if (existing.rows[0]) {
    if (name && !existing.rows[0].name) {
      await pool.query(`UPDATE owners SET name=$1, updated_at=now() WHERE id=$2`, [name, existing.rows[0].id])
      existing.rows[0].name = name
    }
    return existing.rows[0] as Owner
  }
  const res = await pool.query(
    `INSERT INTO owners (email, name) VALUES ($1, $2) RETURNING id, email, name, created_at`,
    [email, name]
  )
  return res.rows[0] as Owner
}

/** Set the owner's name from what they entered at onboarding. Sign-in only fills a blank name,
 * so this value is not overwritten by a later login. */
export async function updateOwnerName(ownerId: string, name: string): Promise<void> {
  await controlPlanePool().query(`UPDATE owners SET name=$1, updated_at=now() WHERE id=$2`, [name, ownerId])
}

export async function getOwnerById(id: string): Promise<Owner | null> {
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT id, email, name, created_at FROM owners WHERE id=$1`, [id])
  return (res.rows[0] as Owner) || null
}

/** Tenants owned by an owner. */
export async function getOwnerTenants(ownerId: string): Promise<TenantRow[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.created_at,
            t.billing_interval, t.razorpay_subscription_id, t.razorpay_checkout_url, t.subscription_status,
            t.razorpay_linked_account_id, t.noreply_email, t.campaign_email,
            p.slug AS plan, p.monthly_price_inr, COALESCE(p.max_custom_domains, 0) AS max_custom_domains,
            i.rds_endpoint, i.s3_bucket, i.ec2_target, i.region
     FROM owner_tenants ot
     JOIN tenants t ON t.id = ot.tenant_id
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE ot.owner_id = $1 ORDER BY t.created_at DESC`,
    [ownerId]
  )
  return res.rows as TenantRow[]
}

export interface TenantOwner extends Owner {
  role: string
  linked_at: string
}

/** Owners of a tenant — the reverse of getOwnerTenants, for the admin object page. */
export async function getTenantOwners(tenantId: string): Promise<TenantOwner[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT o.id, o.email, o.name, o.created_at, ot.role, ot.created_at AS linked_at
     FROM owner_tenants ot
     JOIN owners o ON o.id = ot.owner_id
     WHERE ot.tenant_id = $1
     ORDER BY ot.created_at`,
    [tenantId]
  )
  return res.rows as TenantOwner[]
}

/** Link an owner to a tenant they created. */
export async function linkOwnerTenant(ownerId: string, tenantId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1, $2)
     ON CONFLICT (owner_id, tenant_id) DO NOTHING`,
    [ownerId, tenantId]
  )
}

// ── Bank accounts (payout verification) ──────────────────────────────────────

export interface BankAccount {
  id: string
  owner_id: string
  verification_status: string
  account_number: string | null
  ifsc: string | null
  holder_name: string | null
  upi_id: string | null
  verified_name: string | null
}

/** Upsert + record a verified/failed bank account for an owner. */
export async function saveBankVerification(args: {
  ownerId: string
  accountNumber?: string | null
  ifsc?: string | null
  holderName?: string | null
  upiId?: string | null
  status: 'pending' | 'initiated' | 'verified' | 'unverified' | 'failed'
  ref?: string | null
  verifiedName?: string | null
}): Promise<BankAccount> {
  const pool = controlPlanePool()
  // Upsert: one active bank record per owner (no tenant_id yet during onboarding).
  const res = await pool.query(
    `INSERT INTO tenant_bank_accounts
       (owner_id, account_number, ifsc, holder_name, upi_id, verification_status, verification_ref, verified_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (owner_id) DO UPDATE SET
       account_number=EXCLUDED.account_number, ifsc=EXCLUDED.ifsc,
       holder_name=EXCLUDED.holder_name, upi_id=EXCLUDED.upi_id,
       verification_status=EXCLUDED.verification_status,
       verification_ref=COALESCE(EXCLUDED.verification_ref, tenant_bank_accounts.verification_ref),
       verified_name=COALESCE(EXCLUDED.verified_name, tenant_bank_accounts.verified_name),
       updated_at=now()
     RETURNING id, owner_id, verification_status, account_number, ifsc, holder_name, upi_id, verified_name`,
    [
      args.ownerId,
      args.accountNumber || null,
      args.ifsc || null,
      args.holderName || null,
      args.upiId || null,
      args.status,
      args.ref || null,
      args.verifiedName || null,
    ]
  )
  return res.rows[0] as BankAccount
}

/** The owner's current bank account (for gating go-live). */
/**
 * The owner's bank alongside the linked account of whichever store it settles to. Used by the
 * dashboard to show verification state, and by a re-verify to know which Route account to push
 * the corrected details at — Razorpay refuses a second linked account on the same email, so a
 * correction must update the existing one rather than create another.
 */
export async function getOwnerBankWithRoute(ownerId: string): Promise<{
  accountNumber: string | null
  ifsc: string | null
  holderName: string | null
  verifiedName: string | null
  verificationStatus: string | null
  verificationRef: string | null
  linkedAccountId: string | null
  tenantSlug: string | null
} | null> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT b.account_number, b.ifsc, b.holder_name, b.verified_name,
            b.verification_status, b.verification_ref,
            COALESCE(b.linked_account_id, t.razorpay_linked_account_id) AS linked_account_id,
            t.slug AS tenant_slug
       FROM tenant_bank_accounts b
       LEFT JOIN owner_tenants ot ON ot.owner_id = b.owner_id
       LEFT JOIN tenants t ON t.id = ot.tenant_id AND t.status = 'active'
      WHERE b.owner_id = $1
      ORDER BY b.created_at DESC LIMIT 1`,
    [ownerId]
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    accountNumber: row.account_number ?? null,
    ifsc: row.ifsc ?? null,
    holderName: row.holder_name ?? null,
    verifiedName: row.verified_name ?? null,
    verificationStatus: row.verification_status ?? null,
    verificationRef: row.verification_ref ?? null,
    linkedAccountId: row.linked_account_id ?? null,
    tenantSlug: row.tenant_slug ?? null,
  }
}

export async function getOwnerBankAccount(ownerId: string): Promise<BankAccount | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, owner_id, verification_status, account_number, ifsc, holder_name, upi_id, verified_name
     FROM tenant_bank_accounts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [ownerId]
  )
  return (res.rows[0] as BankAccount) || null
}

/**
 * The payout account for a store. Rows carry both owner_id and tenant_id, and the tenant one is
 * what the operator wants: an owner with several stores can have a different account per store.
 */
export async function getTenantBankAccount(tenantId: string): Promise<BankAccount | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, owner_id, verification_status, account_number, ifsc, holder_name, upi_id, verified_name
     FROM tenant_bank_accounts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId]
  )
  return (res.rows[0] as BankAccount) || null
}

/**
 * Whether the owner has bank details we can settle to.
 *
 * 'verified' means a penny-drop confirmed the holder name. 'unverified' means the details are
 * well-formed but no penny-drop ran — which is the normal case here, because that check needs
 * RazorpayX and this platform settles through Route. Both pass: Razorpay validates the account
 * for real when the Route linked account is configured, so gating go-live on a penny-drop we
 * cannot perform would block every store. 'pending' and 'failed' do not pass.
 */
export async function hasVerifiedBank(ownerId: string): Promise<boolean> {
  const status = (await getOwnerBankAccount(ownerId))?.verification_status
  return status === 'verified' || status === 'unverified'
}

// ── Plan comparison (data-driven from plan_features) ─────────────────────────

// Human-readable comparison rows: each maps to a representative scope key. A plan
// "has" the feature if its plan_features includes that key (checked live).
export const COMPARISON_ROWS: { group: string; label: string; scopeKey: string | null }[] = [
  { group: 'Storefront', label: 'Full storefront (catalogue, cart, checkout)', scopeKey: null }, // null = all plans
  { group: 'Storefront', label: 'Wishlist & product compare', scopeKey: null },
  { group: 'Storefront', label: 'Cash on delivery', scopeKey: null },
  { group: 'Catalogue', label: 'Products & categories', scopeKey: 'products:read' },
  { group: 'Catalogue', label: 'Brands', scopeKey: 'brands:read' },
  { group: 'Catalogue', label: 'AI catalogue enrichment', scopeKey: 'catalog_enrichment:read' },
  { group: 'Catalogue', label: 'Google/Amazon channel sync', scopeKey: 'merchant_sync:read' },
  { group: 'Sales', label: 'Orders & fulfilment', scopeKey: 'orders:read' },
  { group: 'Sales', label: 'Invoices & cash sale', scopeKey: 'invoices:read' },
  { group: 'Sales', label: 'Quotations', scopeKey: 'quotations:read' },
  { group: 'Sales', label: 'Returns & replacements', scopeKey: 'returns:read' },
  { group: 'Sales', label: 'CRM & tasks', scopeKey: 'crm:read' },
  { group: 'Fulfilment', label: 'Packing slips & labels', scopeKey: 'packing_slips:read' },
  { group: 'Fulfilment', label: 'Delhivery pickup scheduling', scopeKey: 'delhivery:read' },
  { group: 'Fulfilment', label: 'QuickScan (mobile)', scopeKey: 'quick_scan:read' },
  { group: 'Finance', label: 'Inventory & purchase orders', scopeKey: 'inventory:read' },
  { group: 'Finance', label: 'Warehouse shelving', scopeKey: 'shelving:read' },
  { group: 'Finance', label: 'GST compliance & filing', scopeKey: 'gst:read' },
  { group: 'Finance', label: 'Financial reports & payouts', scopeKey: 'financial:read' },
  { group: 'Marketing', label: 'Coupons & reviews', scopeKey: 'coupons:read' },
  { group: 'Marketing', label: 'Email mailer & campaigns', scopeKey: 'mailer:read' },
  { group: 'Marketing', label: 'Traffic analytics', scopeKey: 'traffic:read' },
  { group: 'AI & B2B', label: 'AI admin assistant', scopeKey: 'agent:read' },
  { group: 'AI & B2B', label: 'B2B partner portal & RFQs', scopeKey: 'business_customers:read' },
  { group: 'Platform', label: 'Audit log & service accounts', scopeKey: 'audit:read' },
]

/** Which scope keys each plan has (for the comparison table). */
export async function planFeatureMatrix(): Promise<Record<string, Set<string>>> {
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT p.slug, pf.scope_key FROM plan_features pf JOIN plans p ON p.id = pf.plan_id`)
  const matrix: Record<string, Set<string>> = {}
  for (const r of res.rows) {
    ;(matrix[r.slug] ||= new Set()).add(r.scope_key)
  }
  return matrix
}

// ── Onboarding drafts ─────────────────────────────────────────────────────────
