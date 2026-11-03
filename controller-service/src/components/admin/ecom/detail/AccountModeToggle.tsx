'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'
import SettingRow from './SettingRow'

export default function AccountModeToggle({ tenantId, initial, hasOwnCreds }: { tenantId: string; initial: boolean; hasOwnCreds: boolean }) {
  const router = useRouter()
  const toast = useActionToast()
  const [ownRazorpay, setOwnRazorpay] = useState(initial)

  // Turning ON needs connected creds; the API refuses it too (409).
  const canEnable = ownRazorpay || hasOwnCreds

  async function toggle() {
    const next = !ownRazorpay
    const res = await fetch(`/api/admin/ecom/${tenantId}/account-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ own_razorpay: next }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Failed to update account mode')
    setOwnRazorpay(next)
    toast.success(next ? 'Collecting on their own Razorpay' : 'Collecting on the platform account')
    router.refresh()
  }

  return (
    <SettingRow
      title="Collection account"
      value={ownRazorpay ? 'Own Razorpay (no platform charges)' : 'Platform (Route settlement)'}
      hint={canEnable ? undefined : 'Connect a Razorpay account first.'}
    >
      <ActionButton
        action={{
          label: ownRazorpay ? 'Switch to platform' : 'Switch to own Razorpay',
          icon: ArrowLeftRight,
          onClick: toggle,
          disabled: !canEnable,
          confirm: { title: 'Change collection account?', message: ownRazorpay ? 'New orders will be collected on the platform account and settled to the store via Route.' : 'New orders will be collected on the store’s own Razorpay; the platform takes no charges on them.' },
        }}
      />
    </SettingRow>
  )
}
