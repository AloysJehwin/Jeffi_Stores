'use client'

import { useEffect, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import type { PriceRow, PricingSettings } from '@/lib/compute/spec'

type View = {
  prices: PriceRow[]
  settings: PricingSettings
  presets: { key: string; label: string; awsInrMonth: number; inrMonth: number; inrDay: number }[]
}

const ctl = `${inputCls} h-control py-0`
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const SETTINGS: { key: keyof PricingSettings; label: string; step: string }[] = [
  { key: 'usdInr', label: 'USD → INR', step: '0.01' },
  { key: 'margin', label: 'Margin (0.25 = 25%)', step: '0.01' },
  { key: 'gstRate', label: 'GST rate', step: '0.01' },
  { key: 'platformShareUsd', label: 'Platform share per store (USD/month)', step: '0.5' },
  { key: 'rootVolumeGb', label: 'Server disk (GB)', step: '1' },
  { key: 'poolCapacity', label: 'Starter stores per shared server', step: '1' },
  { key: 'sharedDbCapacity', label: 'Starter stores per shared database', step: '1' },
  { key: 'sharedDbStorageGb', label: 'Starter database storage (GB)', step: '1' },
  { key: 'sharedDbMaxConnections', label: 'Shared database connections', step: '10' },
  { key: 'minPrepayDays', label: 'Days of servers paid upfront', step: '1' },
  { key: 'graceDays', label: 'Grace days on a negative wallet', step: '1' },
]

export default function ComputePricingClient() {
  const canWrite = useCanWrite('ecom_billing:write')
  const toast = useActionToast()
  const [view, setView] = useState<View | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})

  const load = (v: View) => {
    setView(v)
    setSettings(Object.fromEntries(SETTINGS.map(s => [s.key, String(v.settings[s.key])])))
  }

  useEffect(() => {
    api<View>('/api/admin/ecom/compute-pricing').then(({ ok, data }) => ok && load(data))
  }, [])

  async function save(json: unknown) {
    const { ok, data } = await api<View & { error?: string }>('/api/admin/ecom/compute-pricing', { method: 'PATCH', json })
    if (!ok) return toast.result({ ok: false, text: data.error || 'Could not save' })
    load(data)
    toast.result({ ok: true, text: 'Saved' })
  }

  if (!view) return <p className="text-sm text-foreground-muted">Loading...</p>

  return (
    <div className="space-y-6">
      <section className="overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Size</th>
              <th className="px-4 py-3 text-right font-medium">AWS cost / month</th>
              <th className="px-4 py-3 text-right font-medium">Store pays / month</th>
              <th className="px-4 py-3 text-right font-medium">Per day</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {view.presets.map(p => (
              <tr key={p.key}>
                <td className="px-4 py-2.5 text-foreground">{p.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{inr(p.awsInrMonth)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{inr(p.inrMonth)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{inr(p.inrDay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-border-default bg-surface-elevated p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map(s => (
            <label key={s.key} className="block">
              <span className="mb-1 block text-xs text-foreground-muted">{s.label}</span>
              <input
                className={ctl}
                type="number"
                step={s.step}
                disabled={!canWrite}
                value={settings[s.key] ?? ''}
                onChange={e => setSettings({ ...settings, [s.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        {canWrite && (
          <button
            type="button"
            className={`${btnPrimary} mt-4 h-control py-0`}
            onClick={() => save({ settings: Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, Number(v)])) })}
          >
            Save settings
          </button>
        )}
      </section>

      <section className="overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Resource</th>
              <th className="px-4 py-3 text-right font-medium">USD / hour</th>
              <th className="px-4 py-3 text-right font-medium">Multi-AZ / hour</th>
              <th className="px-4 py-3 text-right font-medium">USD / GB-month</th>
              <th className="px-4 py-3 text-right font-medium">Multi-AZ / GB-month</th>
              <th className="px-4 py-3 text-center font-medium">Offered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {view.prices.map(p => (
              <tr key={p.code} className={p.sellable ? '' : 'opacity-60'}>
                <td className="px-4 py-2.5 text-foreground">
                  {p.label}
                  <span className="block font-mono text-xs text-foreground-muted">{p.code}</span>
                </td>
                {(['usdHourly', 'usdHourlyMultiAz', 'usdGbMonth', 'usdGbMonthMultiAz'] as const).map(f => (
                  <td key={f} className="px-4 py-2.5 text-right">
                    {p[f] == null ? (
                      <span className="text-foreground-muted">—</span>
                    ) : (
                      <UsdCell
                        value={p[f] as number}
                        editable={canWrite}
                        onSave={v => save({ code: p.code, [f.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)]: v })}
                      />
                    )}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-center">
                  <input type="checkbox" aria-label="Offered" checked={p.sellable} disabled={!canWrite} onChange={e => save({ code: p.code, sellable: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function UsdCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  if (!editable) return <span className="tabular-nums">${value}</span>
  const commit = () => {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n)
    else setV(String(value))
  }
  return (
    <input
      className={`${ctl} w-28 text-right tabular-nums`}
      type="number"
      min="0"
      step="0.0001"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()}
    />
  )
}
