import { mergeAndPublish, type DraftAdapter } from '@/lib/admin/draft-branches'
import type { Resolution } from '@/lib/admin/draft-merge'
import type { DraftActor, DraftDb } from '@/lib/admin/draft-locks'

const CONTENT_COLS = [
  'name', 'gstin', 'contact_name', 'phone', 'email', 'address', 'payment_terms', 'notes',
  'bank_name', 'account_number', 'ifsc', 'upi_id', 'is_active',
] as const

/** A suppliers row in the draft's shape. */
export function supplierContentOf(row: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(CONTENT_COLS.map(k => [k, row[k] ?? null]))
}

export async function liveSupplierContent(db: DraftDb, supplierId: string): Promise<Record<string, unknown> | null> {
  const r = await db.query(`SELECT ${CONTENT_COLS.join(', ')} FROM suppliers WHERE id = $1`, [supplierId])
  return r.rows[0] ? supplierContentOf(r.rows[0]) : null
}

const intOrNull = (v: unknown) => {
  if (v == null || v === '') return null
  const n = parseInt(String(v))
  return Number.isFinite(n) ? n : null
}

/** Writes draft content to the live supplier; is_active only when the content carries it. */
export async function applySupplierContent(db: DraftDb, supplierId: string, f: Record<string, any>) {
  await db.query(
    `UPDATE suppliers SET
       name=$1, gstin=$2, contact_name=$3, phone=$4, email=$5, address=$6,
       payment_terms=$7, notes=$8, bank_name=$9, account_number=$10, ifsc=$11, upi_id=$12,
       is_active=COALESCE($13::boolean, is_active),
       updated_at=NOW()
     WHERE id=$14`,
    [
      f.name,
      f.gstin || null,
      f.contact_name || null,
      f.phone || null,
      f.email || null,
      f.address || null,
      intOrNull(f.payment_terms),
      f.notes || null,
      f.bank_name || null,
      f.account_number || null,
      f.ifsc || null,
      f.upi_id || null,
      f.is_active != null ? f.is_active : null,
      supplierId,
    ]
  )
}

export const supplierDrafts: DraftAdapter = {
  type: 'supplier',
  table: 'supplier_drafts',
  entityKey: 'supplier_id',
  labels: {
    gstin: 'GSTIN',
    contact_name: 'Contact name',
    payment_terms: 'Payment terms',
    bank_name: 'Bank',
    account_number: 'Account number',
    ifsc: 'IFSC',
    upi_id: 'UPI ID',
    is_active: 'Active',
  },
  live: liveSupplierContent,
  // The editor saves its form, which has no is_active: a field the draft does not carry is one it left alone.
  toContent: row => {
    const f = (row.fields ?? {}) as Record<string, unknown>
    const base = (row.base ?? {}) as Record<string, unknown>
    return Object.fromEntries(CONTENT_COLS.filter(k => k in f || k in base).map(k => [k, k in f ? f[k] : base[k]]))
  },
  toColumns: c => ({ fields: c }),
  lockLive: async (db, id) => {
    await db.query(`SELECT 1 FROM suppliers WHERE id = $1 FOR UPDATE`, [id])
  },
  apply: (db, id, merged) => applySupplierContent(db, id, merged),
}

/** Merge a supplier draft into live. Throws DraftConflictError while overlapping edits are unresolved. */
export function publishSupplierDraft(
  draftId: string,
  opts: { actor?: DraftActor; resolutions?: Record<string, Resolution>; epoch?: number | null } = {}
) {
  return mergeAndPublish(supplierDrafts, draftId, opts.actor, opts)
}
