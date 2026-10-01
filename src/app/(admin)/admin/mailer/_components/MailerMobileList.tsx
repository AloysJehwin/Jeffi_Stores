'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Send, Trash2 } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface Campaign {
  id: string
  title: string
  template_key: string
  subject: string
  audience_type: string
  recipient_count: number | null
  status: string
  scheduled_at: string | null
  sent_at: string | null
  created_at: string
}

interface Props {
  campaigns: Campaign[]
  templateLabels: Record<string, string>
  statusStyles: Record<string, string>
  currentListUrl: string
  host?: string
}

function formatDate(c: Campaign): string {
  if (c.status === 'scheduled' && c.scheduled_at) {
    return `Scheduled ${new Date(c.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}`
  }
  if (c.sent_at) {
    return new Date(c.sent_at).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    })
  }
  return new Date(c.created_at).toLocaleDateString('en-IN')
}

export default function MailerMobileList({
  campaigns,
  templateLabels,
  statusStyles,
  currentListUrl,
  host,
}: Props) {
  const router = useRouter()
  const confirm = useConfirm()
  const canWrite = useCanWrite('campaigns:write')

  const [selected, setSelected] = useState<Campaign | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const viewUrl = (c: Campaign) => ap(`/admin/mailer/${c.id}?back=${encodeURIComponent(currentListUrl)}`, host)

  async function dispatch(c: Campaign) {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/admin/mailer/${c.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatchNow: true }),
      })
      setSelected(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: Campaign) {
    const ok = await confirm({
      title: 'Delete Campaign',
      message: `Delete campaign "${c.title}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok || busy) return
    setBusy(true)
    try {
      await fetch(`/api/admin/mailer/${c.id}`, { method: 'DELETE' })
      setSelected(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function buildActions(c: Campaign): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View campaign',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(viewUrl(c)),
      },
    ]
    if (canWrite && (c.status === 'draft' || c.status === 'scheduled')) {
      actions.push({
        key: 'dispatch',
        label: 'Dispatch now',
        icon: <Send className="w-4 h-4" />,
        disabled: busy,
        onSelect: () => dispatch(c),
      })
    }
    if (canWrite && c.status !== 'sending') {
      actions.push({
        key: 'delete',
        label: 'Delete campaign',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        disabled: busy,
        onSelect: () => remove(c),
      })
    }
    return actions
  }

  const statusBadge = (status: string) => (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 capitalize ${statusStyles[status] || 'bg-surface-secondary text-foreground-muted'}`}
    >
      {status}
    </span>
  )

  return (
    <div className="space-y-3">
      {campaigns.map(c => (
        <MobileListCard key={c.id} ariaLabel={`Open ${c.title}`} onTap={() => setSelected(c)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{c.title}</p>
              <p className="text-xs text-foreground-muted truncate">{c.subject}</p>
            </div>
            {statusBadge(c.status)}
          </div>
          <p className="text-xs text-foreground-muted mt-2">
            {templateLabels[c.template_key] || c.template_key} · {c.audience_type.replace('_', ' ')}
          </p>
          {c.recipient_count != null && (
            <p className="text-xs text-foreground-muted mt-0.5">{c.recipient_count} recipients</p>
          )}
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title}
        subtitle={selected?.subject}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            Actions
          </button>
        }
      >
        {selected && (
          <dl className="px-5 py-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-foreground-muted">Status</dt>
              <dd>{statusBadge(selected.status)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-foreground-muted">Template</dt>
              <dd className="text-foreground text-right">
                {templateLabels[selected.template_key] || selected.template_key}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-foreground-muted">Audience</dt>
              <dd className="text-foreground text-right capitalize">{selected.audience_type.replace('_', ' ')}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-foreground-muted">Recipients</dt>
              <dd className="text-foreground text-right">{selected.recipient_count ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-foreground-muted">Date</dt>
              <dd className="text-foreground text-right">{formatDate(selected)}</dd>
            </div>
          </dl>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.title}
        actions={selected ? buildActions(selected) : []}
      />
    </div>
  )
}
