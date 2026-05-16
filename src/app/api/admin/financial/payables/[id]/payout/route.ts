import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const RZP_KEY = process.env.RAZORPAYX_KEY_ID!
const RZP_SECRET = process.env.RAZORPAYX_KEY_SECRET!
const RZP_ACCOUNT = process.env.RAZORPAYX_ACCOUNT_NUMBER!
const RZP_AUTH = 'Basic ' + Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString('base64')

async function rzpPost(path: string, body: object) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: RZP_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.description || `RazorpayX error on ${path}`)
  return json
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!RZP_KEY || !RZP_SECRET || !RZP_ACCOUNT) {
      return NextResponse.json({ error: 'RazorpayX not configured' }, { status: 500 })
    }

    const body = await request.json()
    const { mode, amount, notes } = body

    if (!mode || !amount) {
      return NextResponse.json({ error: 'mode and amount are required' }, { status: 400 })
    }
    if (!['NEFT', 'RTGS', 'IMPS', 'UPI'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }

    const expense = await queryOne<any>(
      `SELECT e.*, s.name AS supplier_name, s.phone AS supplier_phone,
              s.email AS supplier_email, s.bank_name, s.account_number,
              s.ifsc, s.upi_id
       FROM expenses e
       LEFT JOIN purchase_orders po ON po.id = e.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE e.id = $1`,
      [params.id]
    )
    if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

    const payAmount = parseFloat(amount)
    if (isNaN(payAmount) || payAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    if (mode === 'UPI' && !expense.upi_id) {
      return NextResponse.json({ error: 'Supplier has no UPI ID on file' }, { status: 400 })
    }
    if (mode !== 'UPI' && (!expense.account_number || !expense.ifsc)) {
      return NextResponse.json({ error: 'Supplier has no bank account on file' }, { status: 400 })
    }

    const contact = await rzpPost('/contacts', {
      name: expense.supplier_name || 'Supplier',
      email: expense.supplier_email || undefined,
      contact: expense.supplier_phone || undefined,
      type: 'vendor',
      reference_id: expense.po_id || expense.id,
    })

    let fundAccount: any
    if (mode === 'UPI') {
      fundAccount = await rzpPost('/fund_accounts', {
        contact_id: contact.id,
        account_type: 'vpa',
        vpa: { address: expense.upi_id },
      })
    } else {
      fundAccount = await rzpPost('/fund_accounts', {
        contact_id: contact.id,
        account_type: 'bank_account',
        bank_account: {
          name: expense.supplier_name || 'Supplier',
          ifsc: expense.ifsc,
          account_number: expense.account_number,
        },
      })
    }

    const rawNarration = notes || `Payment ${expense.expense_number}`
    const narration = rawNarration.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30).trim()

    const payout = await rzpPost('/payouts', {
      account_number: RZP_ACCOUNT,
      fund_account_id: fundAccount.id,
      amount: Math.round(payAmount * 100),
      currency: 'INR',
      mode,
      purpose: 'payout',
      queue_if_low_balance: true,
      narration,
      reference_id: expense.id,
    })

    const payment_date = new Date().toISOString().slice(0, 10)
    await query(
      `INSERT INTO expense_payments (expense_id, amount, payment_date, payment_method, reference, notes, payout_id, payout_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [params.id, payAmount, payment_date, mode.toLowerCase(), payout.id,
       notes || null, payout.id, payout.status]
    )

    const paidResult = await queryOne<{ paid: string }>(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM expense_payments WHERE expense_id = $1',
      [params.id]
    )
    const paid = parseFloat(paidResult?.paid || '0')
    const total = parseFloat(expense.total_amount)
    const newStatus = paid >= total ? 'paid' : 'partial'
    await query('UPDATE expenses SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, params.id])

    return NextResponse.json({
      success: true,
      payout_id: payout.id,
      payout_status: payout.status,
      amount: payAmount,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
