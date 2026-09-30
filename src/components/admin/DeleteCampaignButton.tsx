'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

export default function DeleteCampaignButton({ id, title }: { id: string; title: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const confirm = useConfirm()
  const canWrite = useCanWrite('campaigns:write')

  async function handleDelete() {
    const ok = await confirm({
      title: 'Delete Campaign',
      message: `Delete campaign "${title}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return

    setLoading(true)
    await fetch(`/api/admin/mailer/${id}`, { method: 'DELETE' })
    router.refresh()
    setLoading(false)
  }

  if (!canWrite) return null

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="text-red-500 hover:underline text-sm disabled:opacity-50"
    >
      {loading ? 'Deleting…' : 'Delete'}
    </button>
  )
}
