'use client'

import { useMemo, useState } from 'react'
import Toggle from '@/components/ui/Toggle'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { DeliverySettings } from '@/lib/shipping/delivery-rules'
import { applyDeliveryRules } from '@/lib/shipping/delivery-rules'

interface Props {
  initial: DeliverySettings
}

const SAMPLE_BASE_CHARGE = 120
const SAMPLE_SUBTOTALS = [500, 2000, 6000]

export default function DeliverySettingsForm({ initial }: Props) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [settings, setSettings] = useState<DeliverySettings>(initial)
  const [saving, setSaving] = useState<string | null>(null)

  function bump<K extends keyof DeliverySettings>(key: K, value: DeliverySettings[K]) {
    setSettings(s => ({ ...s, [key]: value }))
  }

  async function save(key: string, value: string | number | boolean) {
    setSaving(key)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key, value: typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value) }),
      })
      if (res.ok) {
        showToast('Saved', 'success')
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to save', 'error')
      }
    } finally {
      setSaving(null)
    }
  }

  async function toggleEnabled(next: boolean) {
    bump('enabled', next)
    await save('delivery_charges_enabled', next)
  }

  const previewRows = useMemo(() => {
    return SAMPLE_SUBTOTALS.map(subtotal => {
      const r = applyDeliveryRules({ baseCharge: SAMPLE_BASE_CHARGE, subtotal, settings })
      return { subtotal, ...r }
    })
  }, [settings])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 p-4 bg-surface-secondary rounded-lg border border-border-default">
        <div>
          <p className="text-sm font-semibold text-foreground">Charge for delivery</p>
          <p className="text-xs text-foreground-muted mt-0.5">
            {settings.enabled
              ? 'Delivery is calculated per Delhivery rates and applied to checkout.'
              : 'Delivery is FREE on every order. Computed shipping is ignored.'}
          </p>
        </div>
        <Toggle
          checked={settings.enabled}
          onChange={toggleEnabled}
          disabled={saving === 'delivery_charges_enabled' || !canWrite}
        />
      </div>

      <div className={`space-y-5 ${settings.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <Field
          label="Free shipping threshold"
          hint="Subtotal at or above which shipping is free regardless of zone. 0 disables."
          prefix="₹"
          value={settings.freeThreshold}
          onChange={v => bump('freeThreshold', v)}
          onBlur={() => save('delivery_free_threshold', settings.freeThreshold)}
          saving={saving === 'delivery_free_threshold' || !canWrite}
        />
      </div>

      <div className="bg-surface-secondary rounded-lg border border-border-default p-4">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-3">
          Preview (base charge ₹{SAMPLE_BASE_CHARGE})
        </h3>
        <div className="space-y-1.5">
          {previewRows.map(r => (
            <div key={r.subtotal} className="grid grid-cols-3 gap-3 text-sm">
              <span className="text-foreground-secondary">Subtotal ₹{r.subtotal.toLocaleString('en-IN')}</span>
              <span className="text-foreground font-semibold tabular-nums">
                {r.charge === 0 ? (
                  <span className="text-green-600 dark:text-green-400">Free</span>
                ) : (
                  <>₹{r.charge.toFixed(2)}</>
                )}
              </span>
              <span className="text-xs text-foreground-muted self-center">
                {r.source === 'admin_disabled' && 'delivery disabled'}
                {r.source === 'free_threshold' && `≥ ₹${r.freeThreshold} threshold`}
                {r.source === 'as_is' && 'no rule applied'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  hint?: string
  prefix?: string
  suffix?: string
  value: number
  max?: number
  onChange: (v: number) => void
  onBlur: () => void
  saving: boolean
}

function Field({ label, hint, prefix, suffix, value, max, onChange, onBlur, saving }: FieldProps) {
  // Mirrors NumberControl: a string draft so deleting the last digit leaves the field empty
  // instead of snapping back to 0. Reverts to the last committed value if left blank.
  const [draft, setDraft] = useState<string>(String(value))
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : String(Number.isFinite(value) ? value : 0)

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-foreground-muted mb-2">{hint}</p>}
      <div className="relative max-w-xs">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary text-sm">{prefix}</span>
        )}
        <input
          type="number"
          min={0}
          max={max}
          step={1}
          value={shown}
          onFocus={() => {
            setDraft(String(Number.isFinite(value) ? value : 0))
            setEditing(true)
          }}
          onChange={e => {
            setDraft(e.target.value)
            const parsed = parseFloat(e.target.value)
            if (Number.isFinite(parsed)) onChange(parsed)
          }}
          onBlur={() => {
            setEditing(false)
            onBlur()
          }}
          disabled={saving}
          className={`w-full ${prefix ? 'pl-7' : 'pl-3'} ${suffix ? 'pr-9' : 'pr-3'} py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-secondary text-sm">{suffix}</span>
        )}
      </div>
    </div>
  )
}
