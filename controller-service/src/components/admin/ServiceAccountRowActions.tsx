'use client'

import { useRouter } from 'next/navigation'
import RowActions from '@/components/admin/RowActions'
import { useToast } from '@/contexts/ToastContext'

export default function ServiceAccountRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const { showToast } = useToast()

  async function revoke() {
    const res = await fetch(`/api/admin/service-accounts/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast((await res.json().catch(() => ({})))?.error || 'Failed to revoke service account', 'error')
      return
    }
    showToast(`Service account "${name}" revoked`, 'success')
    router.refresh()
  }

  return (
    <RowActions
      size="sm"
      actions={[
        {
          key: 'revoke',
          kind: 'revoke',
          label: 'Revoke',
          onSelect: revoke,
          confirm: {
            title: 'Revoke service account?',
            message: `"${name}" will be permanently revoked. Any systems using this certificate will immediately lose access. This cannot be undone.`,
            confirmLabel: 'Revoke',
            variant: 'danger',
          },
        },
      ]}
    />
  )
}
