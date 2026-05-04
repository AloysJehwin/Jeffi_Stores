import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'

export async function GET() {
  const setting = await queryOne(`SELECT value FROM site_settings WHERE key = 'min_order_amount'`, [])
  return NextResponse.json({
    minOrderAmount: setting ? parseFloat(setting.value) || 0 : 0,
  })
}
