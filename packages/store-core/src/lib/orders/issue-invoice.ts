import type { PoolClient } from 'pg'
import { getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence } from '@/lib/catalog/gst'

export interface IssuedInvoice {
  invoiceNumber: string
  invoiceDate: string
  financialYear: string
  sequence: number
}

/** Numbers an order's invoice ({prefix}/{FY}/{seq}, prefix from site settings) and records it, inside
 * the caller's transaction. Used by admin-created orders and the AJIO B2B invoice. */
export async function issueOrderInvoice(client: PoolClient, orderId: string, at: Date = new Date()): Promise<IssuedInvoice> {
  const settingsResult = await client.query("SELECT value FROM site_settings WHERE key = 'invoice_prefix'")
  const prefix = settingsResult.rows[0]?.value || 'JS'
  const financialYear = getFinancialYear(at)
  const sequence = await getNextInvoiceSequence(client, financialYear)
  const invoiceNumber = generateInvoiceNumber(prefix, financialYear, sequence)
  const invoiceDate = at.toISOString()
  await client.query(`UPDATE orders SET invoice_number = $1, invoice_date = $2 WHERE id = $3`, [invoiceNumber, invoiceDate, orderId])
  await client.query(`INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`, [
    orderId,
    invoiceNumber,
    financialYear,
    sequence,
  ])
  return { invoiceNumber, invoiceDate, financialYear, sequence }
}
