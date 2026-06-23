// Razorpay does not expose a public offers listing API.
// Offers are hardcoded here and updated when bank deals change.
import { NextResponse } from 'next/server'

const OFFERS = [
  { id: 'hdfc-cc', name: 'HDFC Bank', payment_method: 'Credit Card', description: '5% cashback on HDFC Bank Credit Cards', min_purchase_amount: 1000 },
  { id: 'sbi-emi', name: 'SBI Card', payment_method: 'Credit Card', description: 'No-cost EMI on SBI Credit Cards', min_purchase_amount: 749 },
  { id: 'icici-cc', name: 'ICICI Bank', payment_method: 'Credit Card', description: '10% instant discount on ICICI Credit Cards', min_purchase_amount: 1500 },
  { id: 'axis-cc', name: 'Axis Bank', payment_method: 'Credit Card', description: '5% cashback on Axis Bank Cards', min_purchase_amount: 1000 },
  { id: 'kotak-cc', name: 'Kotak Bank', payment_method: 'Credit Card', description: '7.5% instant discount on Kotak Cards', min_purchase_amount: 2000 },
  { id: 'rupay-cc', name: 'RuPay', payment_method: 'Credit Card', description: '10% cashback on RuPay Credit Cards', min_purchase_amount: 500 },
]

export async function GET() {
  return NextResponse.json({ offers: OFFERS })
}
