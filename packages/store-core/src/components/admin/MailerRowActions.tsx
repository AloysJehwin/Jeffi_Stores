'use client'

import { useRouter } from 'next/navigation'
import RowActions from '@/components/admin/RowActions'
import { useToast } from '@/contexts/ToastContext'

export default function MailerRowActions({
  id,
  title,
  viewHref,
  canDelete,
}: {
  id: string
  title: string
  viewHref: string
  canDelete: boolean
}) {
  const router = useRouter()
  const { showToast } = useToast()

  async function deleteCampaign() {
    const res = await fetch(`/api/admin/mailer/${id}`, { method: 'DELETE' })
    // 423: another admin is editing this draft.
    if (res.status === 423) showToast((await res.json().catch(() => ({}))).error || 'Someone else is editing this message', 'error')
    router.refresh()
  }

  return (
    <RowActions
      size="sm"
      actions={[
        { key: 'view', kind: 'view', label: 'View campaign', href: viewHref },
        {
          key: 'delete',
          kind: 'delete',
          label: 'Delete Campaign',
          scope: 'campaigns:write',
          hidden: !canDelete,
          onSelect: deleteCampaign,
          confirm: {
            title: 'Delete Campaign',
            message: `Delete campaign "${title}"? This action cannot be undone.`,
            confirmLabel: 'Delete',
            variant: 'danger',
          },
        },
      ]}
    />
  )
}
