import { notFound } from 'next/navigation'
import { queryOne, queryMany, queryCount } from '@/lib/shared/db'
import Pagination from '@/components/admin/Pagination'
import DispatchCampaignButton from '@/components/admin/DispatchCampaignButton'
import AutoRefresh from '@/components/admin/AutoRefresh'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { TONE_CLS } from '@/components/admin/kit/tones'
import { Card, DetailHeader, Field, Fields, Kpi, KpiGrid, PageBody, badgeCls } from '@/components/admin/kit'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TEMPLATE_LABELS: Record<string, string> = {
  review_form_share: 'Review Form Share',
  promotion: 'Promotion',
  event: 'Event',
  announcement: 'Announcement',
  custom: 'Custom',
}

const channelLabel = (c: { template_key: string; channels?: Record<string, { slug: string }> | null }, labels: Record<string, string>) =>
  c.template_key === 'library'
    ? Object.entries(c.channels ?? {}).map(([k, v]) => `${k === 'sms' ? 'SMS' : k === 'whatsapp' ? 'WhatsApp' : 'Email'}: ${v.slug}`).join(' · ') || 'No channels'
    : labels[c.template_key] || c.template_key

const STATUS_STYLES: Record<string, string> = {
  draft: TONE_CLS.muted,
  scheduled: TONE_CLS.blue,
  sending: TONE_CLS.amber,
  sent: TONE_CLS.green,
  failed: TONE_CLS.red,
}

interface Campaign {
  id: string
  title: string
  template_key: string
  channels?: Record<string, { slug: string }> | null
  subject: string
  template_data: Record<string, string>
  audience_type: string
  audience_filter: Record<string, unknown>
  recipient_count: number | null
  status: string
  scheduled_at: string | null
  sent_at: string | null
  created_at: string
}

interface LogRow {
  email: string | null
  channel: string
  to_address: string | null
  status: string
  error: string | null
  sent_at: string
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ logPage?: string; back?: string }>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const host = await getHost()
  const campaign = await queryOne<Campaign>('SELECT * FROM email_campaigns WHERE id = $1', [id])
  if (!campaign) notFound()

  const back = resolvedSearchParams?.back
  const backUrl = back && back.startsWith('/admin/marketing/messaging') ? back : '/admin/marketing/messaging'

  const logPage = Math.max(1, parseInt(resolvedSearchParams.logPage || '1', 10))
  const logPageSize = 50

  const [logs, logTotal] = await Promise.all([
    queryMany<LogRow>(
      'SELECT email, channel, to_address, status, error, sent_at FROM email_campaign_logs WHERE campaign_id = $1 ORDER BY sent_at DESC LIMIT $2 OFFSET $3',
      [id, logPageSize, (logPage - 1) * logPageSize]
    ),
    queryCount('SELECT COUNT(*) FROM email_campaign_logs WHERE campaign_id = $1', [id]),
  ])

  const buildUrl = (p: number) => ap(`/admin/marketing/messaging/${id}${p > 1 ? `?logPage=${p}` : ''}`, host)

  const sentCount = logs.filter(l => l.status === 'sent').length
  const failedCount = logs.filter(l => l.status === 'failed').length
  // SMS/WhatsApp outcomes land after the send — keep refreshing for 10 minutes.
  const awaiting = campaign.status === 'sending' || logs.some(l =>
    l.status === 'sent' && l.channel !== 'email' && Date.now() - new Date(l.sent_at).getTime() < 600_000)

  return (
    <PageBody>
      <AutoRefresh active={awaiting} />
      <DetailHeader
        back={{ href: ap(backUrl, host), label: 'Messaging' }}
        title={campaign.title}
        subtitle={campaign.subject}
        status={<span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[campaign.status] || 'bg-surface-secondary text-foreground-muted'}`}>{campaign.status}</span>}
        actions={(campaign.status === 'draft' || campaign.status === 'scheduled') && <DispatchCampaignButton id={campaign.id} />}
      />

      <KpiGrid>
        {[
          { label: campaign.template_key === 'library' ? 'Channels' : 'Template', value: channelLabel(campaign, TEMPLATE_LABELS) },
          { label: 'Audience', value: campaign.audience_type.replace(/_/g, ' ') },
          { label: 'Recipients', value: campaign.recipient_count ?? '—' },
          {
            label: campaign.sent_at ? 'Sent' : campaign.scheduled_at ? 'Scheduled' : 'Created',
            value: campaign.sent_at
              ? new Date(campaign.sent_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
              : campaign.scheduled_at
                ? new Date(campaign.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
                : new Date(campaign.created_at).toLocaleDateString('en-IN'),
          },
        ].map(stat => (
          <Kpi key={stat.label} label={stat.label} value={String(stat.value)} />
        ))}
      </KpiGrid>

      {Object.keys(campaign.template_data).length > 0 && (
        <Card title="Template data">
          <Fields>
            {Object.entries(campaign.template_data).map(([k, v]) => (
              <Field key={k} label={<span className="capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>} value={<span className="break-all">{v}</span>} />
            ))}
          </Fields>
        </Card>
      )}

      {logs.length > 0 && (
        <div>
          <Card
            title="Delivery log"
            flush
            action={
              <div className="flex gap-4 text-sm">
                <span className="font-medium text-green-600 dark:text-green-400">{sentCount} sent</span>
                {failedCount > 0 && <span className="font-medium text-red-500">{failedCount} failed</span>}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                    {['Email', 'Status', 'Sent At', 'Error'].map(h => (
                      <th key={h} className="px-5 py-2.5 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={i} className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40">
                      <td className="px-5 py-2.5 text-foreground-secondary">
                        {l.to_address || l.email}
                        {l.channel !== 'email' && <span className="ml-1.5 text-[10px] uppercase text-foreground-muted">{l.channel}</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        <span className={badgeCls(l.status === 'sent' ? 'green' : 'red')}>{l.status}</span>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-foreground-secondary">
                        {new Date(l.sent_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-red-500">{l.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination page={logPage} total={logTotal} pageSize={logPageSize} buildUrl={buildUrl} />
        </div>
      )}
    </PageBody>
  )
}
