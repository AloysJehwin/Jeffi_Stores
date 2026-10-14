'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Trash2, ExternalLink, Link as LinkIcon, ClipboardList } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface FormRow {
  id: string
  title: string
  slug: string
  coupon_code: string | null
  submissions_count: number
  is_active: boolean
}

interface Props {
  forms: FormRow[]
  backUrl: string
  formsBase: string
}

export default function ReviewFormsMobileList({ forms, backUrl, formsBase }: Props) {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useHasScope('review_forms:write')

  const [selected, setSelected] = useState<FormRow | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const formUrl = (f: FormRow) => `${formsBase}/${f.slug}`

  async function copyLink(f: FormRow) {
    try {
      await navigator.clipboard.writeText(formUrl(f))
      showToast('Link copied', 'success')
    } catch {
      showToast('Could not copy link', 'error')
    }
  }

  async function deleteForm(f: FormRow) {
    const ok = await confirm({
      title: 'Delete Review Form',
      message: `Delete "${f.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/review-forms/${f.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to delete form.', 'error')
        return
      }
      setSelected(null)
      showToast(`"${f.title}" deleted`, 'success')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function buildActions(f: FormRow): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'open',
        label: 'Open public form',
        icon: <ExternalLink className="w-4 h-4" />,
        onSelect: () => window.open(formUrl(f), '_blank', 'noopener,noreferrer'),
      },
      {
        key: 'copy',
        label: 'Copy shareable link',
        icon: <LinkIcon className="w-4 h-4" />,
        onSelect: () => copyLink(f),
      },
      {
        key: 'submissions',
        label: 'View submissions',
        icon: <ClipboardList className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/review-forms/${f.id}/submissions`)),
      },
    ]
    if (canWrite) {
      actions.push({
        key: 'delete',
        label: 'Delete form',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        disabled: busy,
        onSelect: () => deleteForm(f),
      })
    }
    return actions
  }

  return (
    <div className="divide-y divide-border-default">
      {forms.map(f => (
        <div key={f.id} className="py-3 first:pt-0 last:pb-0">
          <MobileListCard ariaLabel={`Open ${f.title}`} onTap={() => setSelected(f)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground truncate">{f.title}</div>
                <div className="text-xs text-foreground-muted truncate">/{f.slug}</div>
              </div>
              <span
                className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
                  f.is_active
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground'
                }`}
              >
                {f.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="text-xs text-foreground-muted mt-2">
              Coupon: {f.coupon_code || 'None'} · {f.submissions_count} submissions
            </div>
          </MobileListCard>
        </div>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title}
        subtitle={selected ? `/${selected.slug}` : undefined}
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
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  selected.is_active
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground-muted'
                }`}
              >
                {selected.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <p className="text-xs text-foreground-muted">Coupon</p>
                <p className="text-sm text-foreground font-medium">{selected.coupon_code || 'None'}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Submissions</p>
                <p className="text-sm text-foreground font-medium">{selected.submissions_count}</p>
              </div>
            </div>
            <div className="border-t border-border-default pt-4">
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Shareable link</p>
              <p className="text-sm text-accent-500 break-all">{formUrl(selected)}</p>
            </div>
          </div>
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
