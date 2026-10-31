import { notFound } from 'next/navigation'
import { queryOne, queryMany, queryCount } from '@/lib/shared/db'
import { ServerPagedItems } from '@/components/admin/kit/infinite'
import DispatchCampaignButton from '@/components/admin/DispatchCampaignButton'
import AutoRefresh from '@/components/admin/AutoRefresh'
import Tooltip from '@/components/ui/Tooltip'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { TONE_CLS, type Tone } from '@/components/admin/kit/tones'
import { Card, DetailHeader, Field, Fields, Kpi, KpiGrid, PageBody, badgeCls } from '@/components/admin/kit'
import { campaignPushReport } from '@/lib/push/broadcast'
import { ChangeLog } from '@/components/admin/change-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TEMPLATE_LABELS: Record<string, string> = {
  review_form_share: 'Review Form Share',
  promotion: 'Promotion',
  event: 'Event',
  announcement: 'Announcement',
  custom: 'Custom',
}

const channelLabel = (
  c: { template_key: string; channels?: Record<string, { slug?: string; title?: string }> | null },
  labels: Record<string, string>
) =>
  c.template_key === 'library'
    ? Object.entries(c.channels ?? {})
        .map(([k, v]) =>
          k === 'push' ? `App push: ${v.title || '—'}` : `${k === 'sms' ? 'SMS' : k === 'whatsapp' ? 'WhatsApp' : 'Email'}: ${v.slug}`
        )
        .join(' · ') || 'No channels'
    : labels[c.template_key] || c.template_key

const STATUS_TONE: Record<string, Tone> = { sent: 'green', failed: 'red', skipped: 'muted', deferred: 'blue', queued: 'amber', sending: 'amber' }
const SKIP_LABEL: Record<string, string> = {
  frequency_cap: 'Daily push limit reached',
  quiet_hours: 'Waiting for quiet hours to end',
  opted_out: 'Turned off offers',
  push_disabled: 'Marketing push is off in Site Controls',
  device_disabled: 'App uninstalled',
  device_removed: 'Device removed',
  device_signed_out: 'Signed out of the app',
  device_signed_in: 'Signed in since',
}

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
  channels?: Record<string, { slug?: string; title?: string }> | null
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
  push_device_id: string | null
  send_after: string | null
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

  const [logs, logTotal, counts, push] = await Promise.all([
    queryMany<LogRow>(
      'SELECT email, channel, to_address, status, error, sent_at, push_device_id, send_after FROM email_campaign_logs WHERE campaign_id = $1 ORDER BY sent_at DESC LIMIT $2 OFFSET $3',
      [id, logPageSize, (logPage - 1) * logPageSize]
    ),
    queryCount('SELECT COUNT(*) FROM email_campaign_logs WHERE campaign_id = $1', [id]),
    queryOne<{ sent: string; failed: string; skipped: string; pending: string }>(
      `SELECT count(*) FILTER (WHERE status = 'sent')::text AS sent, count(*) FILTER (WHERE status = 'failed')::text AS failed,
              count(*) FILTER (WHERE status = 'skipped')::text AS skipped,
              count(*) FILTER (WHERE status IN ('queued', 'sending'))::text AS pending
         FROM email_campaign_logs WHERE campaign_id = $1`,
      [id]
    ),
    campaignPushReport(id).catch(() => null),
  ])

  const sentCount = Number(counts?.sent ?? 0)
  const failedCount = Number(counts?.failed ?? 0)
  const skippedCount = Number(counts?.skipped ?? 0)
  const campaignError = logs.find(l => l.status === 'failed' && l.error)?.error ?? null
  // SMS/WhatsApp outcomes land after the send — keep refreshing for 10 minutes; pushes while queued.
  const awaiting =
    campaign.status === 'sending' ||
    Number(counts?.pending ?? 0) > 0 ||
    logs.some(l => l.status === 'sent' && l.channel !== 'email' && Date.now() - new Date(l.sent_at).getTime() < 600_000)
  const when = (v: string) =>
    new Date(v).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

  return (
    <PageBody>
      <AutoRefresh active={awaiting} />
      <DetailHeader
        back={{ href: ap(backUrl, host), label: 'Messaging' }}
        title={campaign.title}
        subtitle={campaign.subject}
        status={(() => {
          const badge = (
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[campaign.status] || 'bg-surface-secondary text-foreground-muted'}`}
            >
              {campaign.status}
            </span>
          )
          return campaignError ? <Tooltip content={campaignError}>{badge}</Tooltip> : badge
        })()}
        actions={
          (campaign.status === 'draft' || campaign.status === 'scheduled') && (
            <DispatchCampaignButton id={campaign.id} />
          )
        }
      />

      <KpiGrid>
        {[
          {
            label: campaign.template_key === 'library' ? 'Channels' : 'Template',
            value: channelLabel(campaign, TEMPLATE_LABELS),
          },
          { label: 'Audience', value: campaign.audience_type.replace(/_/g, ' ') },
          { label: 'Recipients', value: campaign.recipient_count ?? '—' },
          {
            label: campaign.sent_at ? 'Sent' : campaign.scheduled_at ? 'Scheduled' : 'Created',
            value: campaign.sent_at
              ? new Date(campaign.sent_at).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Kolkata',
                })
              : campaign.scheduled_at
                ? new Date(campaign.scheduled_at).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Kolkata',
                  })
                : new Date(campaign.created_at).toLocaleDateString('en-IN'),
          },
        ].map(stat => (
          <Kpi key={stat.label} label={stat.label} value={String(stat.value)} />
        ))}
      </KpiGrid>

      {push && (
        <Card
          title="App push"
          hint="Sent, failed and skipped count app installs. Opens and orders count signed-in customers (a tap on the push or the inbox, and an order within 24 hours of it); taps on signed-out installs can't be tied to anyone."
        >
          <KpiGrid>
            <Kpi label="Sent" value={push.sent.toLocaleString('en-IN')} sub={push.signedOut ? `${push.signedOut.toLocaleString('en-IN')} signed-out installs` : undefined} />
            <Kpi label="Failed" value={push.failed.toLocaleString('en-IN')} />
            <Kpi
              label="Skipped"
              value={push.skipped.toLocaleString('en-IN')}
              sub={push.capped ? `${push.capped.toLocaleString('en-IN')} over the daily limit` : undefined}
            />
            <Kpi label="Waiting" value={push.waiting.toLocaleString('en-IN')} sub="Quiet hours or queued" />
            <Kpi label="Opened" value={push.opened.toLocaleString('en-IN')} />
            <Kpi label="Converted" value={push.converted.toLocaleString('en-IN')} sub="Order within 24h of opening" highlight />
          </KpiGrid>
        </Card>
      )}

      {Object.keys(campaign.template_data).length > 0 && (
        <Card title="Template data">
          <Fields>
            {Object.entries(campaign.template_data).map(([k, v]) => (
              <Field
                key={k}
                label={<span className="capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>}
                value={<span className="break-all">{v}</span>}
              />
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
                {skippedCount > 0 && <span className="font-medium text-foreground-muted">{skippedCount} skipped</span>}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                    {['Recipient', 'Status', 'Sent At', 'Detail'].map(h => (
                      <th key={h} className="px-5 py-2.5 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <ServerPagedItems
                  wrap="tbody"
                  param="logPage"
                  page={logPage}
                  total={logTotal}
                  noun="deliveries"
                  items={logs.map((l, i) => ({
                    key: String((logPage - 1) * logPageSize + i),
                    node: (
                    <tr
                      key={i}
                      className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40"
                    >
                      <td className="px-5 py-2.5 text-foreground-secondary">
                        {l.to_address || l.email || (l.channel === 'push' ? 'Signed-out install' : '—')}
                        {l.channel !== 'email' && (
                          <span className="ml-1.5 text-[10px] uppercase text-foreground-muted">{l.channel}</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <span className={badgeCls(STATUS_TONE[l.status] ?? 'red')}>{l.status}</span>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-foreground-secondary">{when(l.sent_at)}</td>
                      <td className={`px-5 py-2.5 text-xs ${l.status === 'failed' ? 'text-red-500' : 'text-foreground-muted'}`}>
                        {l.status === 'deferred' && l.send_after ? (
                          `Quiet hours — sends ${when(l.send_after)}`
                        ) : l.error ? (
                          <Tooltip content={SKIP_LABEL[l.error] ?? l.error}>
                            <span className="inline-block max-w-[24ch] truncate align-bottom">{SKIP_LABEL[l.error] ?? l.error}</span>
                          </Tooltip>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    ),
                  }))}
                />
              </table>
            </div>
          </Card>
        </div>
      )}

      <ChangeLog kind="email_campaign" id={id} />
    </PageBody>
  )
}
