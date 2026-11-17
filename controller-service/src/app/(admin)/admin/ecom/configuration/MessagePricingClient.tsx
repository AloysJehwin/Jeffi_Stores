'use client'

import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import LiveUsdInr, { type FxRate } from './LiveUsdInr'

type Rate = { costInr: number; feeInr: number; exact: boolean }
type Sheet = { marginPct: number; mediaInr: number; rates: Record<string, Rate> }
type Row = { key: string; provider: string; channel: 'sms' | 'whatsapp' | 'email'; label: string }
type View = { sheet: Sheet; fx: FxRate; defaults: Sheet; rows: Row[]; active: Record<'sms' | 'whatsapp' | 'email', string> }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round(n * 100) / 100

/** Configuration → Message pricing: what every provider charges per message, and what a store pays for it. */
export default function MessagePricingClient() {
  const canWrite = useCanWrite('ecom_billing:write')
  const toast = useActionToast()
  const [view, setView] = useState<View | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [saving, setSaving] = useState(false)

  const load = (v: View) => {
    setView(v)
    setSheet(JSON.parse(JSON.stringify(v.sheet)))
  }
  useEffect(() => {
    api<View>('/api/admin/ecom/message-pricing').then(({ ok, data }) => ok && load(data))
  }, [])

  if (!view || !sheet) return <div className="h-64 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />

  const setRate = (key: string, patch: Partial<Rate>) => setSheet(s => (s ? { ...s, rates: { ...s.rates, [key]: { ...s.rates[key], ...patch } } } : s))
  const storePays = (cost: number) => round2(cost * (1 + (Number(sheet.marginPct) || 0) / 100))
  const changed = JSON.stringify(sheet) !== JSON.stringify(view.sheet)

  async function save() {
    if (!sheet) return
    setSaving(true)
    const { ok, data } = await api<View>('/api/admin/ecom/message-pricing', { method: 'PUT', json: sheet })
    setSaving(false)
    if (!ok) return toast.error((data as any).error || 'Could not save the message pricing.')
    load(data)
    toast.success('Saved. New messages are priced with it within a minute.')
  }

  const num = (v: string) => (v === '' ? 0 : Number(v))

  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5 space-y-5 min-w-0">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Message pricing</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          What each provider costs per message, and what a store pays from its wallet: the cost plus the margin. The processing fee is kept when a
          message fails. With &quot;Provider&apos;s price&quot;, the charge is corrected to the price the provider reports once the message is
          delivered (Twilio reports it); otherwise the fixed cost stands. The platform&apos;s own messages are charged at cost.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1 min-w-0">
          <span className="text-xs font-medium text-foreground-secondary">Margin (%)</span>
          <input className={inputCls} type="number" min={0} max={500} step="1" value={sheet.marginPct} disabled={!canWrite} onChange={e => setSheet({ ...sheet, marginPct: num(e.target.value) })} />
        </label>
        <LiveUsdInr fx={view.fx} />
        <label className="space-y-1 min-w-0">
          <span className="text-xs font-medium text-foreground-secondary">Image header fee (₹ per message)</span>
          <input className={inputCls} type="number" min={0} step="0.01" value={sheet.mediaInr} disabled={!canWrite} onChange={e => setSheet({ ...sheet, mediaInr: num(e.target.value) })} />
        </label>
      </div>

      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted border-b border-border-default">
              <th className="py-2 pl-4 sm:pl-0 pr-3 font-medium">Provider · channel</th>
              <th className="py-2 pr-3 font-medium">Cost (₹ / message)</th>
              <th className="py-2 pr-3 font-medium">Processing fee (₹)</th>
              <th className="py-2 pr-3 font-medium">Charge</th>
              <th className="py-2 pr-4 sm:pr-0 font-medium text-right">Store pays</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map(r => {
              const rate = sheet.rates[r.key]
              const live = view.active[r.channel] === r.provider
              return (
                <tr key={r.key} className="border-b border-border-default last:border-0">
                  <td className="py-2.5 pl-4 sm:pl-0 pr-3 whitespace-nowrap">
                    <span className="font-medium text-foreground">{r.label}</span>
                    {live && <span className="ml-2 rounded bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-700 dark:text-green-300">In use</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <input className={`${inputCls} max-w-[7rem]`} type="number" min={0} step="0.01" value={rate.costInr} disabled={!canWrite} onChange={e => setRate(r.key, { costInr: num(e.target.value) })} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input className={`${inputCls} max-w-[7rem]`} type="number" min={0} step="0.01" value={rate.feeInr} disabled={!canWrite} onChange={e => setRate(r.key, { feeInr: num(e.target.value) })} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <label className={`inline-flex items-center gap-2 text-xs ${r.provider === 'twilio' ? '' : 'opacity-50'}`} title={r.provider === 'twilio' ? '' : 'Only Twilio reports a per-message price'}>
                      <input type="checkbox" checked={rate.exact} disabled={!canWrite || r.provider !== 'twilio'} onChange={e => setRate(r.key, { exact: e.target.checked })} />
                      Provider&apos;s price
                    </label>
                  </td>
                  <td className="py-2.5 pr-4 sm:pr-0 text-right font-medium text-foreground whitespace-nowrap">
                    {inr(storePays(rate.costInr))}
                    {rate.exact && r.provider === 'twilio' && <span className="block text-[11px] font-normal text-foreground-muted">estimate; corrected on delivery</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} disabled={!changed || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save pricing'}
          </button>
          <button type="button" className={btnGhost} disabled={!changed || saving} onClick={() => setSheet(JSON.parse(JSON.stringify(view.sheet)))}>
            Discard changes
          </button>
          <button type="button" className={btnGhost} disabled={saving} onClick={() => setSheet(JSON.parse(JSON.stringify(view.defaults)))}>
            <RotateCcw className="inline w-3.5 h-3.5 mr-1" />
            Defaults
          </button>
        </div>
      )}
    </div>
  )
}
