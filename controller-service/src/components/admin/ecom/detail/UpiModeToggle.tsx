'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Power } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'
import SettingRow from './SettingRow'

type Mode = 'auto' | 'off'

/**
 * The platform's on/off switch for a store's UPI (tenants.upi_mode auto|off). While on, the store's
 * provider picks itself: PhonePe when it has saved credentials, otherwise its own UPI ID.
 */
export default function UpiModeToggle({ tenantId, initial, hasPhonePe, upiId }: { tenantId: string; initial?: string | null; hasPhonePe: boolean; upiId: string | null }) {
  const router = useRouter()
  const toast = useActionToast()
  // Rows from before v2 (platform / own / manual) all mean "on".
  const [mode, setMode] = useState<Mode>(initial === 'off' ? 'off' : 'auto')
  const on = mode === 'auto'
  const provider = hasPhonePe ? 'PhonePe (the store’s own account)' : upiId ? 'Direct to the store’s UPI ID' : null

  async function apply() {
    const next: Mode = on ? 'off' : 'auto'
    const res = await fetch(`/api/admin/ecom/${tenantId}/upi-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Failed to update UPI collection')
    setMode(next)
    toast.success(next === 'auto' ? 'UPI collection turned on' : 'UPI collection turned off')
    router.refresh()
  }

  return (
    <SettingRow
      title="UPI collection"
      value={!on ? 'Off (no UPI at checkout)' : provider ? `On · ${provider}` : 'On · not set up by the store yet'}
      hint={
        <>
          UPI ID: {upiId ? <span className="font-mono">{upiId}</span> : 'none'} · PhonePe credentials: {hasPhonePe ? 'saved' : 'not saved'}. UPI money goes straight to the store; the platform takes no charges on it.
        </>
      }
    >
      <ActionButton
        action={{
          label: on ? 'Turn off' : 'Turn on',
          icon: Power,
          danger: on,
          onClick: apply,
          confirm: {
            title: on ? 'Turn off UPI for this store?' : 'Turn on UPI for this store?',
            message: on
              ? 'The UPI section disappears from the store’s checkout; cards, net banking and COD are unaffected.'
              : provider
                ? `The store collects UPI again — ${provider}.`
                : 'UPI appears at checkout once the store adds a UPI ID or PhonePe credentials.',
          },
        }}
      />
    </SettingRow>
  )
}
