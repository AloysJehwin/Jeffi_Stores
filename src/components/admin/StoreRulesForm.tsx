'use client'

import { useState } from 'react'

export default function StoreRulesForm({ minOrderAmount }: { minOrderAmount: number }) {
  const [value, setValue] = useState(String(minOrderAmount))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) {
      setError('Enter a valid amount (0 to disable)')
      setSaving(false)
      return
    }
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ key: 'min_order_amount', value: String(Math.round(num * 100) / 100) }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to save')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Minimum Order Amount (₹)
        </label>
        <p className="text-xs text-foreground-muted mb-2">Set to 0 to disable the minimum order requirement.</p>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary text-sm">₹</span>
            <input
              type="number"
              min="0"
              step="1"
              value={value}
              onChange={e => { setValue(e.target.value); setSaved(false) }}
              className="pl-7 pr-4 py-2 border border-border-default rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500 w-36"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
          {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </div>
    </div>
  )
}
