'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { SectionCard, FullSpan } from './controls'
import { validateGoogleTagSetting, type GoogleTagSettingKey } from '@/lib/analytics/google-tag'

interface Field {
  key: GoogleTagSettingKey
  label: string
  hint: string
  placeholder: string
}

const FIELDS: Field[] = [
  {
    key: 'google_tag_id',
    label: 'Google tag ID',
    hint: 'From Google Analytics or Google Ads > Google tag. Loads on your storefront.',
    placeholder: 'G-XXXXXXXXXX',
  },
  {
    key: 'google_ads_conversion_id',
    label: 'Ads conversion ID',
    hint: 'The AW- part of the purchase conversion send_to.',
    placeholder: 'AW-123456789',
  },
  {
    key: 'google_ads_conversion_label',
    label: 'Ads conversion label',
    hint: 'The part after the slash in send_to.',
    placeholder: 'AbC-D_efG-h12_34-567',
  },
]

function TagField({ field, initial }: { field: Field; initial: string }) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    const check = validateGoogleTagSetting(field.key, value)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setError('')
    if (check.value === saved) {
      setValue(check.value)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key: field.key, value: check.value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to save')
        showToast('Failed to save', 'error')
        return
      }
      setValue(check.value)
      setSaved(check.value)
      showToast('Saved', 'success')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label className="flex items-baseline gap-2 mb-1 min-w-0">
        <span className="text-sm font-medium text-foreground shrink-0">{field.label}</span>
        <span className="text-xs text-foreground-muted truncate">{field.hint}</span>
      </label>
      <input
        type="text"
        value={value}
        placeholder={field.placeholder}
        onChange={e => {
          setValue(e.target.value)
          if (error) setError('')
        }}
        onBlur={save}
        disabled={saving || !canWrite}
        aria-invalid={!!error}
        className={`w-full px-3 h-control text-sm border rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60 ${error ? 'border-red-500' : 'border-border-secondary'}`}
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

export default function GoogleTagCard({
  initial,
  isTenant,
}: {
  initial: Record<GoogleTagSettingKey, string>
  isTenant: boolean
}) {
  return (
    <SectionCard
      title="Google tag & Ads"
      description="Measure storefront traffic and purchases in Google Analytics and Google Ads. Visitors are asked for cookie consent first; tags only store cookies after they agree."
      columns
    >
      <FullSpan>
        <TagField field={FIELDS[0]} initial={initial.google_tag_id} />
        <p className="mt-1 text-xs text-foreground-muted">
          {isTenant
            ? 'Leave empty to load no Google tag on your store.'
            : 'Leave empty to use the platform default tag.'}
        </p>
      </FullSpan>
      <TagField field={FIELDS[1]} initial={initial.google_ads_conversion_id} />
      <TagField field={FIELDS[2]} initial={initial.google_ads_conversion_label} />
      <FullSpan>
        <p className="text-xs text-foreground-muted">
          With both conversion fields set, every completed order sends a purchase conversion with the order number and
          total. Product IDs match the SKUs sent to Google Merchant Center.
        </p>
      </FullSpan>
    </SectionCard>
  )
}
