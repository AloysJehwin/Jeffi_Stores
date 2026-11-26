import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const CHANNELS = ['whatsapp', 'sms', 'email']
const FAILED = `(m.status = 'failed' OR m.delivery_status IN ('failed', 'undelivered'))`

// Daily outbound messages by outcome for one channel, behind the messaging Overview's insights sheet. WhatsApp and
// SMS read message_logs (provider delivery receipts); email reads the broadcast log, which has no receipts.
// Same gate as the messaging overview API.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'mailer:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, CHANNELS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series =
      q.filter === 'email'
        ? await getInsightsSeries({
            table: 'email_campaign_logs',
            alias: 'm',
            dateColumn: 'sent_at',
            where: `COALESCE(m.channel, 'email') = 'email' AND m.status NOT IN ('queued', 'sending', 'deferred', 'skipped')`,
            series: [
              { key: 'sent', label: 'Sent', where: `m.status <> 'failed'` },
              { key: 'failed', label: 'Failed', where: `m.status = 'failed'` },
            ],
            weeks: q.weeks,
            filter: q.filter,
          })
        : await getInsightsSeries({
            table: 'message_logs',
            alias: 'm',
            dateColumn: 'sent_at',
            where: `m.channel = $1 AND COALESCE(m.direction, 'outbound') = 'outbound'`,
            params: [q.filter],
            series: [
              { key: 'delivered', label: 'Delivered', where: `NOT ${FAILED} AND m.delivery_status IN ('delivered', 'read')` },
              { key: 'pending', label: 'Awaiting receipt', where: `NOT ${FAILED} AND COALESCE(m.delivery_status, '') NOT IN ('delivered', 'read')` },
              { key: 'failed', label: 'Failed', where: FAILED },
            ],
            weeks: q.weeks,
            filter: q.filter,
          })
    return NextResponse.json({ series })
  } catch (err) {
    console.error('[messaging insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
