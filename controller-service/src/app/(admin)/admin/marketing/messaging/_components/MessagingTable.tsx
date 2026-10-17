'use client'

import Link from 'next/link'
import DispatchCampaignButton from '@/components/admin/DispatchCampaignButton'
import MailerRowActions from '@/components/admin/MailerRowActions'
import { ap } from '@/lib/shared/admin-path'
import { DataTable, StatusBadge, type DataCol, type StatusMap } from '@/components/admin/kit'
import MailerMobileList from './MailerMobileList'

export interface Campaign {
  id: string
  title: string
  template_key: string
  channels?: Record<string, { slug: string }> | null
  subject: string
  audience_type: string
  recipient_count: number | null
  status: string
  scheduled_at: string | null
  sent_at: string | null
  created_at: string
}

export const MESSAGE_STATUS: StatusMap = {
  draft: { label: 'Draft', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  sending: { label: 'Sending', tone: 'amber' },
  sent: { label: 'Sent', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
}

export const channelLabel = (
  c: { template_key: string; channels?: Record<string, { slug: string }> | null },
  labels: Record<string, string>
) =>
  c.template_key === 'library'
    ? Object.entries(c.channels ?? {})
        .map(([k, v]) => `${k === 'sms' ? 'SMS' : k === 'whatsapp' ? 'WhatsApp' : 'Email'}: ${v.slug}`)
        .join(' · ') || 'No channels'
    : labels[c.template_key] || c.template_key

const ist = (d: string) =>
  new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

export default function MessagingTable({
  campaigns,
  total,
  page,
  pageSize,
  search,
  host,
  currentListUrl,
  templateLabels,
  statusStyles,
}: {
  campaigns: Campaign[]
  total: number
  page: number
  pageSize: number
  search: string
  host: string
  currentListUrl: string
  templateLabels: Record<string, string>
  statusStyles: Record<string, string>
}) {
  const viewHref = (c: Campaign) =>
    ap(`/admin/marketing/messaging/${c.id}/view?back=${encodeURIComponent(currentListUrl)}`, host)
  const pageHref = (p: number) => {
    const qs = new URLSearchParams({ tab: 'list' })
    if (search) qs.set('search', search)
    if (p > 1) qs.set('page', String(p))
    return ap(`/admin/marketing/messaging?${qs}`, host)
  }

  const cols: DataCol<Campaign>[] = [
    {
      key: 'title',
      label: 'Title',
      render: c => (
        <div className="min-w-0">
          <Link
            href={c.status === 'draft' ? ap(`/admin/marketing/messaging/new?draftId=${c.id}`, host) : viewHref(c)}
            className="font-medium text-foreground transition-colors hover:text-accent-500"
          >
            {c.title}
          </Link>
          <p className="max-w-[200px] truncate text-xs text-foreground-muted">{c.subject}</p>
        </div>
      ),
    },
    {
      key: 'template',
      label: 'Template',
      render: c => <span className="text-foreground-secondary">{channelLabel(c, templateLabels)}</span>,
    },
    {
      key: 'audience',
      label: 'Audience',
      hideBelow: 'lg',
      render: c => <span className="capitalize text-foreground-secondary">{c.audience_type.replace('_', ' ')}</span>,
    },
    {
      key: 'recipients',
      label: 'Recipients',
      num: true,
      render: c => <span className="text-foreground-secondary">{c.recipient_count ?? '—'}</span>,
    },
    { key: 'status', label: 'Status', render: c => <StatusBadge status={c.status} map={MESSAGE_STATUS} /> },
    {
      key: 'date',
      label: 'Date',
      hideBelow: 'lg',
      render: c => (
        <span className="whitespace-nowrap text-xs text-foreground-secondary">
          {c.status === 'scheduled' && c.scheduled_at
            ? `Scheduled ${ist(c.scheduled_at)}`
            : c.sent_at
              ? ist(c.sent_at)
              : new Date(c.created_at).toLocaleDateString('en-IN')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: <span className="sr-only">Actions</span>,
      render: c => (
        <div className="flex items-center justify-end gap-3" onClick={e => e.stopPropagation()}>
          {(c.status === 'draft' || c.status === 'scheduled') && (
            <DispatchCampaignButton id={c.id} scheduledAt={c.scheduled_at} />
          )}
          <MailerRowActions id={c.id} title={c.title} viewHref={viewHref(c)} canDelete={c.status !== 'sending'} />
        </div>
      ),
    },
  ]

  return (
    <DataTable<Campaign>
      mode="server"
      rows={campaigns}
      cols={cols}
      rowKey={c => c.id}
      total={total}
      page={page}
      pageSize={pageSize}
      pageHref={pageHref}
      mobile={
        <MailerMobileList
          campaigns={campaigns}
          templateLabels={templateLabels}
          statusStyles={statusStyles}
          currentListUrl={currentListUrl}
          host={host}
        />
      }
      empty={{
        title: 'No campaigns yet.',
        actionNode: (
          <span className="hidden md:contents">
            <Link href={ap('/admin/marketing/messaging/new', host)} className="text-sm text-accent-500 hover:underline">
              Create your first one.
            </Link>
          </span>
        ),
      }}
    />
  )
}
