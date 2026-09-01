import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { storeBaseUrlAsync } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const url = req.nextUrl.searchParams.get('url')

  if (id) {
    query(
      `UPDATE email_campaigns_sent
       SET clicked_at = COALESCE(clicked_at, NOW()),
           opened_at  = COALESCE(opened_at, NOW())
       WHERE id = $1`,
      [id]
    ).catch(() => {})
  }

  let target = url
  if (!target || !/^https?:\/\//i.test(target)) {
    target = await storeBaseUrlAsync()
  }

  return NextResponse.redirect(target, 302)
}
