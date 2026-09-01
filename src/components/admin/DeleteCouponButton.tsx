'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

export default function DeleteCouponButton({ id, code }: { id: string; code: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('coupons:write')

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Coupon',
      message: `Delete coupon "${code}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return

    setLoading(true)
    const res = await fetch(`/api/admin/coupons/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
    } else {
      const data = await res.json()
      showToast(data.error || 'Failed to delete coupon', 'error')
    }
    setLoading(false)
  }

  if (!canWrite) return null

  return (
    <button onClick={handleDelete} disabled={loading} className="text-red-500 hover:underline text-sm disabled:opacity-50">
      {loading ? 'Deleting…' : 'Delete'}
    </button>
  )
}
