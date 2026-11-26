import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const CHANNELS = ['all', 'email', 'whatsapp', 'sms', 'push']

// Daily automated-campaign sends, split into the ones that led to an order and the rest (so the days stack to the sends), behind the Overview's insights sheet.
// Same gate as the campaigns overview API.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'mailer:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, CHANNELS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const all = q.filter === 'all'
    const series = await getInsightsSeries({
      table: 'email_campaigns_sent',
      alias: 's',
      dateColumn: 'sent_at',
      where: `s.campaign_kind <> 'broadcast'${all ? '' : ' AND s.channel = $1'}`,
      params: all ? [] : [q.filter],
      series: [
        { key: 'unconverted', label: 'No conversion', where: 's.converted_at IS NULL' },
        { key: 'converted', label: 'Converted', where: 's.converted_at IS NOT NULL' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (err) {
    console.error('[campaigns insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
