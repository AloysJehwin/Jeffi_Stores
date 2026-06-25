// Indian GST state codes (2-digit codes for all states and union territories)
const STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01',
  'himachal pradesh': '02',
  'punjab': '03',
  'chandigarh': '04',
  'uttarakhand': '05',
  'haryana': '06',
  'delhi': '07',
  'rajasthan': '08',
  'uttar pradesh': '09',
  'bihar': '10',
  'sikkim': '11',
  'arunachal pradesh': '12',
  'nagaland': '13',
  'manipur': '14',
  'mizoram': '15',
  'tripura': '16',
  'meghalaya': '17',
  'assam': '18',
  'west bengal': '19',
  'jharkhand': '20',
  'odisha': '21',
  'chhattisgarh': '22',
  'madhya pradesh': '23',
  'gujarat': '24',
  'dadra and nagar haveli and daman and diu': '26',
  'maharashtra': '27',
  'andhra pradesh': '37',
  'karnataka': '29',
  'goa': '30',
  'lakshadweep': '31',
  'kerala': '32',
  'tamil nadu': '33',
  'puducherry': '34',
  'andaman and nicobar islands': '35',
  'telangana': '36',
  'ladakh': '38',
}

export function getStateCode(stateName: string): string {
  if (!stateName) return ''
  const normalized = stateName.toLowerCase().trim()
  return STATE_CODES[normalized] || ''
}

export function isInterState(buyerState: string, sellerStateCode: string): boolean {
  const buyerCode = getStateCode(buyerState)
  if (!buyerCode || !sellerStateCode) return false
  return buyerCode !== sellerStateCode
}

export interface GSTBreakdown {
  taxableAmount: number
  cgst: number
  sgst: number
  igst: number
  totalTax: number
}

/** Round a currency/percentage value to 2 decimal places without IEEE 754 drift. */
export function round2(n: number): number {
  return parseFloat(n.toFixed(2))
}

export function calculateGST(inclusivePrice: number, gstRate: number, isIGST: boolean): GSTBreakdown {
  if (gstRate <= 0) {
    return { taxableAmount: inclusivePrice, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }
  }

  const taxableAmount = Math.round((inclusivePrice / (1 + gstRate / 100)) * 100) / 100
  const totalTax = Math.round((inclusivePrice - taxableAmount) * 100) / 100

  if (isIGST) {
    return { taxableAmount, cgst: 0, sgst: 0, igst: totalTax, totalTax }
  }

  const halfTax = Math.round((totalTax / 2) * 100) / 100
  // Ensure cgst + sgst = totalTax exactly (handle rounding)
  const cgst = halfTax
  const sgst = Math.round((totalTax - halfTax) * 100) / 100

  return { taxableAmount, cgst, sgst, igst: 0, totalTax }
}

export function getFinancialYear(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = date.getMonth() // 0-indexed, so March = 2, April = 3
  // Financial year starts April 1
  const fyStart = month >= 3 ? year : year - 1
  const fyEnd = fyStart + 1
  const startShort = String(fyStart).slice(2)
  const endShort = String(fyEnd).slice(2)
  return `${startShort}-${endShort}`
}

export function generateInvoiceNumber(prefix: string, fy: string, seq: number): string {
  const paddedSeq = String(seq).padStart(3, '0')
  return `${prefix}/${fy}/${paddedSeq}`
}

export async function getNextInvoiceSequence(client: any, financialYear: string): Promise<number> {
  // Take max across both tables — guards against orphaned orders.invoice_number with no invoices row
  const result = await client.query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(sequence_number) FROM invoices WHERE financial_year = $1), 0),
       COALESCE((SELECT MAX(CAST(SPLIT_PART(invoice_number, '/', 3) AS INTEGER))
                 FROM orders
                 WHERE invoice_number LIKE $2), 0)
     ) + 1 AS next_seq`,
    [financialYear, `%/${financialYear}/%`]
  )
  return parseInt(result.rows[0].next_seq)
}
