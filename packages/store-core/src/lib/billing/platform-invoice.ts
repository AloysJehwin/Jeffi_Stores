import { generateInvoiceNumber, getFinancialYear, stateFromCode } from '@jeffi/gst'
import { controlPlanePool } from '@/lib/tenant-registry'
import { fetchService } from '@/lib/ecom/service-client'
import { sendPlatformInvoiceEmail } from '@/lib/shared/ecom-emails'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'

// Jeffi's own tax invoices to tenants. Rendered by document-service as the flagship (no wallet charge),
// numbered JC/<FY>/NNN, emailed to the store owner with the PDF. One per payment: (kind, external_ref).

export interface PlatformCharge {
  tenantId: string
  kind: 'subscription' | 'wallet_topup'
  externalRef: string // Razorpay payment id
  description: string
  sac: string
  amountInr: number
  pricesIncludeGst: boolean
  credited?: number // wallet top-ups: the amount added to the wallet
}

const FLAGSHIP = { id: FLAGSHIP_TENANT_ID, slug: 'platform' }
const PREFIX = 'JC'

async function seller(pool: ReturnType<typeof controlPlanePool>) {
  const rows = (await pool.query<{ key: string; value: string }>(`SELECT key, value FROM site_settings WHERE key LIKE 'business_%'`)).rows
  const s = Object.fromEntries(rows.map(r => [r.key, r.value || '']))
  const gstin = (s.business_gstin || process.env.EINVOICE_GSTIN || '').trim()
  return {
    name: s.business_trade_name || s.business_legal_name || s.business_name || 'Jeffi Stores',
    address: s.business_address || undefined,
    state: s.business_state || stateFromCode(gstin.slice(0, 2)) || undefined,
    gstin: gstin.length === 15 ? gstin : undefined,
    email: s.business_email || undefined,
    phone: s.business_phone || undefined,
  }
}

async function buyer(pool: ReturnType<typeof controlPlanePool>, tenantId: string) {
  const r = (await pool.query(
    `SELECT t.display_name, k.business_name, k.gst_number, k.business_address, k.mobile, o.email, o.name AS owner_name
       FROM tenants t
       LEFT JOIN tenant_kyc k ON k.tenant_id = t.id
       LEFT JOIN owner_tenants ot ON ot.tenant_id = t.id
       LEFT JOIN owners o ON o.id = ot.owner_id
      WHERE t.id = $1 LIMIT 1`, [tenantId])).rows[0]
  if (!r) return null
  const gstin = (r.gst_number ?? '').trim().toUpperCase()
  return {
    store: r.display_name as string,
    email: r.email as string | null,
    party: {
      name: r.business_name || r.display_name,
      address: r.business_address || undefined,
      gstin: gstin.length === 15 ? gstin : undefined,
      state: gstin.length === 15 ? stateFromCode(gstin.slice(0, 2)) || undefined : undefined,
      email: r.email || undefined,
      phone: r.mobile || undefined,
    },
  }
}

export async function issuePlatformInvoice(c: PlatformCharge): Promise<void> {
  if (!c.tenantId || c.tenantId === FLAGSHIP_TENANT_ID || !c.externalRef || !(c.amountInr > 0)) return
  const pool = controlPlanePool()
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query(`INSERT INTO platform_invoices (tenant_id, kind, external_ref) VALUES ($1,$2,$3) ON CONFLICT (kind, external_ref) DO NOTHING`, [c.tenantId, c.kind, c.externalRef])
    // Row lock: concurrent callers for the same payment wait here, then see it already sent.
    const row = (await db.query(`SELECT * FROM platform_invoices WHERE kind=$1 AND external_ref=$2 FOR UPDATE`, [c.kind, c.externalRef])).rows[0]
    if (row.sent_at) return void (await db.query('COMMIT'))

    const to = await buyer(pool, c.tenantId)
    if (!to) throw new Error(`tenant ${c.tenantId} not found`)

    let number: string = row.number
    if (!number) {
      const fy = getFinancialYear()
      const seq = (await db.query(
        `INSERT INTO document_sequences (tenant_id, type, financial_year, next_seq) VALUES ($1,'platform_invoice',$2,2)
         ON CONFLICT (tenant_id, type, financial_year) DO UPDATE SET next_seq = document_sequences.next_seq + 1
         RETURNING next_seq - 1 AS seq`, [FLAGSHIP_TENANT_ID, fy])).rows[0].seq
      number = generateInvoiceNumber(PREFIX, fy, Number(seq))
    }

    const res = await fetchService('documents', FLAGSHIP, '/documents/invoice', {
      method: 'POST',
      internal: true,
      body: {
        number,
        reference: c.externalRef,
        seller: await seller(pool),
        buyer: to.party,
        items: [{ description: c.description, hsn: c.sac, quantity: 1, unit: 'service', unit_price: c.amountInr, gst_rate: 18 }],
        prices_include_gst: c.pricesIncludeGst,
        notes: `Paid online via Razorpay (payment ${c.externalRef}). Thank you for choosing Jeffi Commerce.`,
      },
    })
    const doc = await res.json().catch(() => null)
    if (!res.ok || !doc?.id) throw new Error(`render failed: ${res.status} ${doc?.message ?? ''}`)
    const t = doc.totals
    const gst = Math.round((t.cgst + t.sgst + t.igst) * 100) / 100

    const pdfRes = await fetchService('documents', FLAGSHIP, `/documents/${doc.id}/pdf`)
    const pdf = Buffer.from(await pdfRes.arrayBuffer())
    if (to.email) {
      await sendPlatformInvoiceEmail(to.email, {
        kind: c.kind, number, store: to.store, description: c.description,
        taxable: Math.round((t.total - gst) * 100) / 100, gst, total: t.total, credited: c.credited, viewUrl: doc.view_url,
      }, pdf)
    }
    await db.query(
      `UPDATE platform_invoices SET number=$2, document_id=$3, view_url=$4, taxable_inr=$5, gst_inr=$6, total_inr=$7, emailed_to=$8, sent_at=now(), error=NULL WHERE id=$1`,
      [row.id, number, doc.id, doc.view_url, t.total - gst, gst, t.total, to.email]
    )
    await db.query('COMMIT')
  } catch (e: any) {
    await db.query('ROLLBACK').catch(() => {})
    process.stderr.write(`[platform-invoice] ${c.kind} ${c.externalRef}: ${e?.message}\n`)
  } finally {
    db.release()
  }
}

/** Fire-and-forget: billing must never fail a payment confirmation. */
export const issuePlatformInvoiceLater = (c: PlatformCharge) => { void issuePlatformInvoice(c) }
