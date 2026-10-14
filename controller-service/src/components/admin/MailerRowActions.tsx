'use client'

import { useRouter } from 'next/navigation'
import RowActions from '@/components/admin/RowActions'

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

  async function deleteCampaign() {
    await fetch(`/api/admin/mailer/${id}`, { method: 'DELETE' })
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
