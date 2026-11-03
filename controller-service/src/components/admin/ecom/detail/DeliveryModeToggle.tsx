'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'
import SettingRow from './SettingRow'

export default function DeliveryModeToggle({ tenantId, initial, hasOwnCreds }: { tenantId: string; initial: boolean; hasOwnCreds: boolean }) {
  const router = useRouter()
  const toast = useActionToast()
  const [ownDelhivery, setOwnDelhivery] = useState(initial)

  // Turning ON needs a connected token; the API refuses it too (409).
  const canEnable = ownDelhivery || hasOwnCreds

  async function toggle() {
    const next = !ownDelhivery
    const res = await fetch(`/api/admin/ecom/${tenantId}/delivery-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ own_delhivery: next }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Failed to update delivery mode')
    setOwnDelhivery(next)
    toast.success(next ? 'Shipping on their own Delhivery' : 'Shipping on the platform account')
    router.refresh()
  }

  return (
    <SettingRow
      title="Delivery account"
      value={ownDelhivery ? 'Own Delhivery (billed directly)' : 'Platform (wallet debit)'}
      hint={canEnable ? undefined : 'Connect a Delhivery token first.'}
    >
      <ActionButton
        action={{
          label: ownDelhivery ? 'Switch to platform' : 'Switch to own Delhivery',
          icon: ArrowLeftRight,
          onClick: toggle,
          disabled: !canEnable,
          confirm: { title: 'Change delivery account?', message: ownDelhivery ? 'New shipments will go on the platform Delhivery account and be charged to the store’s wallet.' : 'New shipments will go on the store’s own Delhivery account and be billed to them directly.' },
        }}
      />
    </SettingRow>
  )
}
