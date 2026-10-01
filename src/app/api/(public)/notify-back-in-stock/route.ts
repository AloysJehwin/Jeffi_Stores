import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { productId, email } = body ?? {}

  if (!productId || typeof productId !== 'string') {
    return NextResponse.json({ error: 'productId required' }, { status: 400 })
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 })
  }

  await query(
    `INSERT INTO back_in_stock_notify (product_id, email)
     VALUES ($1, $2)
     ON CONFLICT (product_id, email) DO NOTHING`,
    [productId, email.toLowerCase().trim()]
  )

  return NextResponse.json({ ok: true })
}
