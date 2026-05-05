import { notFound } from 'next/navigation'
import Link from 'next/link'
import { queryOne, queryMany, queryCount } from '@/lib/db'
import Pagination from '@/components/admin/Pagination'
import DispatchCampaignButton from '@/components/admin/DispatchCampaignButton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TEMPLATE_LABELS: Record<string, string> = {
  review_form_share: 'Review Form Share',
  promotion: 'Promotion',
  event: 'Event',
  announcement: 'Announcement',
  custom: 'Custom',
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-600',
}

interface Campaign {
  id: string
  title: string
  template_key: string
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
  email: string
  status: string
  error: string | null
  sent_at: string
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { logPage?: string }
}) {
  const campaign = await queryOne<Campaign>('SELECT * FROM email_campaigns WHERE id = $1', [params.id])
  if (!campaign) notFound()

  const logPage = Math.max(1, parseInt(searchParams.logPage || '1', 10))
  const logPageSize = 50

  const [logs, logTotal] = await Promise.all([
    queryMany<LogRow>(
      'SELECT email, status, error, sent_at FROM email_campaign_logs WHERE campaign_id = $1 ORDER BY sent_at DESC LIMIT $2 OFFSET $3',
      [params.id, logPageSize, (logPage - 1) * logPageSize]
    ),
    queryCount('SELECT COUNT(*) FROM email_campaign_logs WHERE campaign_id = $1', [params.id]),
  ])

  const buildUrl = (p: number) => `/admin/mailer/${params.id}${p > 1 ? `?logPage=${p}` : ''}`

  const sentCount = logs.filter(l => l.status === 'sent').length
  const failedCount = logs.filter(l => l.status === 'failed').length

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/mailer" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground truncate">{campaign.title}</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">{campaign.subject}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLES[campaign.status] || 'bg-gray-100 text-gray-600'}`}>
            {campaign.status}
          </span>
          {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
            <DispatchCampaignButton id={campaign.id} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Template', value: TEMPLATE_LABELS[campaign.template_key] || campaign.template_key },
          { label: 'Audience', value: campaign.audience_type.replace(/_/g, ' ') },
          { label: 'Recipients', value: campaign.recipient_count ?? '—' },
          { label: campaign.sent_at ? 'Sent' : campaign.scheduled_at ? 'Scheduled' : 'Created',
            value: campaign.sent_at
              ? new Date(campaign.sent_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
              : campaign.scheduled_at
              ? new Date(campaign.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
              : new Date(campaign.created_at).toLocaleDateString('en-IN') },
        ].map(stat => (
          <div key={stat.label} className="bg-surface-elevated rounded-lg border border-border-default p-4">
            <p className="text-xs text-foreground-secondary">{stat.label}</p>
            <p className="font-semibold text-foreground mt-1 capitalize">{String(stat.value)}</p>
          </div>
        ))}
      </div>

      {Object.keys(campaign.template_data).length > 0 && (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-5 mb-6">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wider mb-3">Template Data</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(campaign.template_data).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-foreground-muted capitalize">{k.replace(/([A-Z])/g, ' $1')}</dt>
                <dd className="text-sm text-foreground mt-0.5 break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-foreground">Delivery Log</h2>
            <div className="flex gap-4 text-sm">
              <span className="text-green-600 font-medium">{sentCount} sent</span>
              {failedCount > 0 && <span className="text-red-500 font-medium">{failedCount} failed</span>}
            </div>
          </div>
          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary">
                  <tr>
                    {['Email', 'Status', 'Sent At', 'Error'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {logs.map((l, i) => (
                    <tr key={i} className="hover:bg-surface-secondary/50 transition-colors">
                      <td className="px-4 py-2.5 text-foreground-secondary">{l.email}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${l.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-foreground-secondary text-xs">{new Date(l.sent_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</td>
                      <td className="px-4 py-2.5 text-red-500 text-xs">{l.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={logPage} total={logTotal} pageSize={logPageSize} buildUrl={buildUrl} />
        </div>
      )}
    </div>
  )
}
