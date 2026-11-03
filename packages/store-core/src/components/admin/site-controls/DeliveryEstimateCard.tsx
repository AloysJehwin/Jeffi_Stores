'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import Toggle from '@/components/ui/Toggle'
import { SectionCard, FullSpan } from '@/components/admin/site-controls/controls'
import type { EddSettings } from '@/lib/shipping/edd'

type Warehouse = { name: string; pin: string; city: string; state: string }
type Preview = {
  zoneLabel: string
  state: string | null
  originPin: string
  handlingDays: number
  transitDays: number
  totalDays: number
  edd: string
}

const DAY_FIELDS: Array<{ key: keyof EddSettings; label: string; hint: string }> = [
  { key: 'handlingDays', label: 'Handling / dispatch', hint: 'Minimum days before an order ships.' },
  { key: 'sameCityDays', label: 'Same city', hint: 'First 3 pincode digits match the warehouse.' },
  { key: 'sameRegionDays', label: 'Same region', hint: 'Same 2-digit postal circle as the warehouse.' },
  { key: 'metroDays', label: 'Metro', hint: 'Destination prefix is in the metro list below.' },
  { key: 'restDays', label: 'Rest of India', hint: 'Everything else.' },
  { key: 'remoteDays', label: 'Remote areas', hint: 'North-East, J&K / Ladakh, Andaman & Nicobar, Lakshadweep.' },
]

const fmt = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

const inputCls =
  'w-full px-3 h-control text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60'

export default function DeliveryEstimateCard() {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [settings, setSettings] = useState<EddSettings | null>(null)
  const [defaults, setDefaults] = useState<EddSettings | null>(null)
  const [metroText, setMetroText] = useState('')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouse, setWarehouse] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pin, setPin] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    fetch('/api/admin/edd-settings', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Failed to load'))))
      .then(d => {
        setSettings(d.settings)
        setDefaults(d.defaults)
        setMetroText(d.settings.metroPrefixes.join(', '))
        setWarehouses(d.warehouses ?? [])
        setWarehouse(d.defaultWarehouse ?? '')
      })
      .catch(e => setError(e.message))
  }, [])

  const draft = (): EddSettings | null =>
    settings && {
      ...settings,
      metroPrefixes: metroText
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean),
    }

  // Debounced live preview against the unsaved draft.
  useEffect(() => {
    const p = pin.replace(/\D/g, '')
    if (p.length !== 6 || !settings) {
      setPreview(null)
      setPreviewError('')
      return
    }
    const t = setTimeout(async () => {
      const res = await fetch('/api/admin/edd-settings/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: p, settings: draft(), defaultWarehouse: warehouse }),
      }).catch(() => null)
      const d = res ? await res.json().catch(() => null) : null
      if (res?.ok && d) {
        setPreview(d)
        setPreviewError('')
      } else {
        setPreview(null)
        setPreviewError(d?.error || 'Preview unavailable')
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, settings, metroText, warehouse])

  async function save() {
    const body = draft()
    if (!body) return
    setSaving(true)
    const res = await fetch('/api/admin/edd-settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: body, defaultWarehouse: warehouse }),
    }).catch(() => null)
    const d = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok && d?.settings) {
      setSettings(d.settings)
      setMetroText(d.settings.metroPrefixes.join(', '))
      showToast('Saved', 'success')
    } else {
      showToast(d?.error || 'Failed to save', 'error')
    }
  }

  function reset() {
    if (!defaults) return
    setSettings(defaults)
    setMetroText(defaults.metroPrefixes.join(', '))
  }

  return (
    <SectionCard
      title="Delivery estimate"
      description="How the expected delivery date is calculated at checkout, on product pages and on each order. Once Delhivery reports its own expected date for a shipment, that date replaces this estimate."
      columns
    >
      {error && (
        <FullSpan>
          <p className="text-sm text-red-500">{error}</p>
        </FullSpan>
      )}
      {settings && (
        <>
          <FullSpan>
            <AdminSelect
              label="Default warehouse"
              hint="Ship-from origin for the estimate (also the default Delhivery pickup location)."
              value={warehouse}
              disabled={!canWrite || warehouses.length === 0}
              options={warehouses.map(w => ({
                value: w.name,
                label: `${w.name} — ${w.pin || 'no pincode'}${w.city ? `, ${w.city}` : ''}`,
              }))}
              onChange={setWarehouse}
            />
          </FullSpan>
          {DAY_FIELDS.map(f => (
            <div key={f.key}>
              <label className="flex items-baseline gap-2 mb-1 min-w-0">
                <span className="text-sm font-medium text-foreground shrink-0">{f.label}</span>
                <span className="text-xs text-foreground-muted truncate">{f.hint}</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={f.key === 'handlingDays' ? 30 : 60}
                  value={settings[f.key] as number}
                  disabled={!canWrite}
                  onChange={e =>
                    setSettings({ ...settings, [f.key]: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                  }
                  className={inputCls}
                />
                <span className="text-sm text-foreground-muted">days</span>
              </div>
            </div>
          ))}
          <FullSpan>
            <label className="flex items-baseline gap-2 mb-1 min-w-0">
              <span className="text-sm font-medium text-foreground shrink-0">Metro pincode prefixes</span>
              <span className="text-xs text-foreground-muted truncate">First 3 digits, comma or space separated.</span>
            </label>
            <textarea
              rows={3}
              value={metroText}
              disabled={!canWrite}
              onChange={e => setMetroText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60 resize-y"
            />
          </FullSpan>
          <FullSpan>
            <div className="flex items-center justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Skip Sundays</span>
                <span className="block text-xs text-foreground-muted">Do not count Sundays as delivery days.</span>
              </span>
              <Toggle
                checked={settings.skipSundays}
                onChange={v => setSettings({ ...settings, skipSundays: v })}
                disabled={!canWrite}
              />
            </div>
          </FullSpan>
          <FullSpan>
            <div className="pt-3 border-t border-border-default">
              <p className="text-sm font-medium text-foreground mb-1">Preview</p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Destination pincode"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  className={`${inputCls} sm:w-48`}
                />
                {preview && (
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">{preview.zoneLabel}</span>
                    {preview.state ? ` (${preview.state})` : ''} · {preview.handlingDays} handling +{' '}
                    {preview.transitDays} transit = {preview.totalDays} days ·{' '}
                    <span className="font-semibold">{fmt(preview.edd)}</span>
                    <span className="text-foreground-muted"> from {preview.originPin}</span>
                  </p>
                )}
                {previewError && <p className="text-sm text-red-500">{previewError}</p>}
              </div>
            </div>
          </FullSpan>
          {canWrite && (
            <FullSpan>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="px-4 h-control text-sm font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="px-4 h-control text-sm font-semibold rounded-lg bg-surface-secondary hover:bg-surface-secondary/70 text-foreground"
                >
                  Reset to defaults
                </button>
              </div>
            </FullSpan>
          )}
        </>
      )}
    </SectionCard>
  )
}
