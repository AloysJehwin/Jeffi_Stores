'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Badge, Empty, TabAction, Tabs, api, btnGhost, btnPrimary, inputCls, pct } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import { AI_CAPABILITY_LABEL } from '@/lib/ai/feature-labels'
import Select from '@/components/ui/Select'

const ctl = `${inputCls} h-control py-0`

type Row = {
  id: string
  capability: string
  provider: string
  model: string
  unit_type: string
  cost_inr: number
  price_inr: number
  active: boolean
  updated_at: string
}
type Cap = 'all' | 'text' | 'embed' | 'vision' | 'image' | 'video'

const CAPS: Cap[] = ['all', 'text', 'embed', 'vision', 'image', 'video']
const UNITS = ['token_1k_in', 'token_1k_out', 'image', 'video_second', 'call']
const UNIT_LABEL: Record<string, string> = {
  token_1k_in: 'per 1k input tokens',
  token_1k_out: 'per 1k output tokens',
  image: 'per image',
  video_second: 'per video second',
  call: 'per call',
}
const margin = (r: { cost_inr: number; price_inr: number }) => (r.price_inr > 0 ? (r.price_inr - r.cost_inr) / r.price_inr : null)
const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
const EMPTY_NEW = { capability: 'image', provider: '', model: '*', unit_type: 'image', cost_inr: '', price_inr: '' }

export default function AiPricingClient() {
  const canWrite = useCanWrite('ecom_billing:write')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [cap, setCap] = useState<Cap>('all')
  const toast = useActionToast()
  const setMsg = (m: { ok: boolean; text: string }) => toast.result(m)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY_NEW)

  useEffect(() => {
    api<{ rows: Row[] }>('/api/admin/ecom/ai-pricing').then(({ ok, data }) => {
      if (ok) setRows(data.rows)
      else setMsg({ ok: false, text: data.error || 'Could not load the price list' })
    })
  }, [])

  const shown = useMemo(() => (rows ?? []).filter(r => cap === 'all' || r.capability === cap), [rows, cap])

  async function patch(id: string, body: Partial<Pick<Row, 'cost_inr' | 'price_inr' | 'active'>>) {
    const { ok, data } = await api<{ row: Row }>('/api/admin/ecom/ai-pricing', { method: 'PATCH', json: { id, ...body } })
    if (!ok) return setMsg({ ok: false, text: data.error || 'Update failed' })
    setRows(rs => (rs ?? []).map(r => (r.id === id ? data.row : r)))
    setMsg({ ok: true, text: 'Saved' })
  }

  async function add() {
    const { ok, data } = await api<{ row: Row }>('/api/admin/ecom/ai-pricing', {
      method: 'POST',
      json: { ...draft, cost_inr: Number(draft.cost_inr || 0), price_inr: Number(draft.price_inr || 0) },
    })
    if (!ok) return setMsg({ ok: false, text: data.error || 'Could not add the row' })
    setRows(rs => [...(rs ?? []), data.row])
    setDraft(EMPTY_NEW)
    setAdding(false)
    setMsg({ ok: true, text: 'Row added' })
  }

  return (
    <div className="space-y-4">
      <Tabs
        tabs={CAPS.map(c => ({ id: c, label: c === 'all' ? 'All' : AI_CAPABILITY_LABEL[c] }))}
        value={cap}
        onChange={setCap}
        actions={canWrite ? <TabAction icon={<Plus className="w-4 h-4" />} label="Add row" onClick={() => setAdding(a => !a)} /> : undefined}
      />

      {adding && canWrite && (
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-7 items-end">
          <Field label="Capability">
            <Select
              aria-label="Capability"
              value={draft.capability}
              onChange={v => setDraft({ ...draft, capability: v })}
              options={CAPS.filter(c => c !== 'all').map(c => ({ value: c as string, label: AI_CAPABILITY_LABEL[c] }))}
            />
          </Field>
          <Field label="Provider">
            <input className={ctl} value={draft.provider} placeholder="razer" onChange={e => setDraft({ ...draft, provider: e.target.value })} />
          </Field>
          <Field label="Model (* = default)">
            <input className={ctl} value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} />
          </Field>
          <Field label="Unit">
            <Select
              aria-label="Unit"
              value={draft.unit_type}
              onChange={v => setDraft({ ...draft, unit_type: v })}
              options={UNITS.map(u => ({ value: u, label: UNIT_LABEL[u] }))}
            />
          </Field>
          <Field label="Cost (INR)">
            <input className={ctl} type="number" min="0" step="0.0001" value={draft.cost_inr} onChange={e => setDraft({ ...draft, cost_inr: e.target.value })} />
          </Field>
          <Field label="Price (INR)">
            <input className={ctl} type="number" min="0" step="0.0001" value={draft.price_inr} onChange={e => setDraft({ ...draft, price_inr: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <button type="button" className={`${btnPrimary} h-control py-0`} onClick={add} disabled={!draft.provider.trim()}>
              Add
            </button>
            <button type="button" className={`${btnGhost} h-control py-0`} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!rows ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : shown.length === 0 ? (
        <Empty msg="No prices for this capability." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-foreground-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Capability</th>
                <th className="text-left px-4 py-3 font-medium">Provider / model</th>
                <th className="text-left px-4 py-3 font-medium">Unit</th>
                <th className="text-right px-4 py-3 font-medium">Cost</th>
                <th className="text-right px-4 py-3 font-medium">Price</th>
                <th className="text-right px-4 py-3 font-medium">Margin</th>
                <th className="text-center px-4 py-3 font-medium">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {shown.map(r => {
                const m = margin(r)
                return (
                  <tr key={r.id} className={r.active ? '' : 'opacity-60'}>
                    <td className="px-4 py-2.5 text-foreground">{AI_CAPABILITY_LABEL[r.capability] ?? r.capability}</td>
                    <td className="px-4 py-2.5 text-foreground">
                      {r.provider}
                      <span className="block text-xs text-foreground-muted font-mono">{r.model === '*' ? 'default' : r.model}</span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground-secondary">{UNIT_LABEL[r.unit_type] ?? r.unit_type}</td>
                    <td className="px-4 py-2.5 text-right">
                      <MoneyCell value={r.cost_inr} editable={canWrite} onSave={v => patch(r.id, { cost_inr: v })} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MoneyCell value={r.price_inr} editable={canWrite} onSave={v => patch(r.id, { price_inr: v })} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {m == null ? <Badge tone="red">Free</Badge> : <Badge tone={m < 0 ? 'red' : m < 0.2 ? 'amber' : 'green'}>{pct(m)}</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="checkbox"
                        aria-label="Active"
                        checked={r.active}
                        disabled={!canWrite}
                        onChange={e => patch(r.id, { active: e.target.checked })}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-foreground-muted mb-1">{label}</span>
      {children}
    </label>
  )
}

function MoneyCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  if (!editable) return <span className="tabular-nums text-foreground">{fmt(value)}</span>
  const commit = () => {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n)
    else setV(String(value))
  }
  return (
    <input
      type="number"
      min="0"
      step="0.0001"
      aria-label="Amount in INR"
      className={`${inputCls} !w-28 h-control !py-0 text-right tabular-nums ml-auto`}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
