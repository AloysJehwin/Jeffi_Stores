'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'

interface ProductUnit {
  id: string
  product_id: string
  variant_id: string
  unit: string
  factor: number | string
  is_base: boolean
  is_purchase_default: boolean
  is_sell_default: boolean
  price_override: number | string | null
  display_label: string | null
  notes: string | null
}

interface UnitRule {
  id: string
  product_unit_id: string
  rule_type: 'tiered_price' | 'gst_threshold' | 'bonus_qty' | 'bundle_split' | 'physical_variance'
  config: any
  is_active: boolean
  priority: number
}

interface Props {
  productId: string
  variantId: string
  baseUnitName?: string  // current pv.unit, used as the suggested base unit name
}

const inputCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-xs focus:ring-1 focus:ring-accent-500 w-full"

export default function UnitsManager({ productId, variantId, baseUnitName }: Props) {
  const { showToast } = useToast()
  const showConfirm = useConfirm()
  const [units, setUnits] = useState<ProductUnit[]>([])
  const [rules, setRules] = useState<UnitRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<{ unit: string; factor: string; display_label: string; price_override: string; is_sell_default: boolean; is_purchase_default: boolean }>({
    unit: '', factor: '', display_label: '', price_override: '', is_sell_default: false, is_purchase_default: false,
  })
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null)
  const [ruleDraftType, setRuleDraftType] = useState<'tiered_price' | 'bonus_qty'>('tiered_price')
  const [tierRows, setTierRows] = useState<Array<{ min_qty: string; price: string }>>([{ min_qty: '', price: '' }])
  const [bonusBuy, setBonusBuy] = useState('')
  const [bonusExtra, setBonusExtra] = useState('')

  const baseUrl = `/api/admin/products/${productId}/variants/${variantId}/units`

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(baseUrl, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUnits(data.units || [])
        setRules(data.rules || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [productId, variantId])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.unit.trim()) { showToast('Unit name is required', 'error'); return }
    const f = parseFloat(draft.factor)
    if (!Number.isFinite(f) || f <= 0) { showToast('Factor must be > 0', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit: draft.unit.trim(),
          factor: f,
          display_label: draft.display_label || null,
          price_override: draft.price_override ? Number(draft.price_override) : null,
          is_sell_default: draft.is_sell_default,
          is_purchase_default: draft.is_purchase_default,
        }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to add unit', 'error'); return }
      setDraft({ unit: '', factor: '', display_label: '', price_override: '', is_sell_default: false, is_purchase_default: false })
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function setFlag(unit: ProductUnit, flag: 'is_base' | 'is_sell_default' | 'is_purchase_default') {
    const res = await fetch(`${baseUrl}/${unit.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [flag]: true }),
    })
    if (!res.ok) {
      const data = await res.json()
      showToast(data.error || 'Failed to update', 'error')
      return
    }
    await load()
  }

  async function deleteUnit(unit: ProductUnit) {
    if (unit.is_base) { showToast('Set another unit as base before deleting this one', 'info'); return }
    const ok = await showConfirm({
      title: 'Delete unit',
      message: `Delete the "${unit.unit}" unit and any rules attached to it?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`${baseUrl}/${unit.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Failed to delete', 'error'); return }
    await load()
  }

  function rulesFor(unitId: string) {
    return rules.filter(r => r.product_unit_id === unitId)
  }

  function startRuleAdd(unitId: string) {
    setExpandedUnitId(unitId)
    setRuleDraftType('tiered_price')
    setTierRows([{ min_qty: '', price: '' }])
    setBonusBuy('')
    setBonusExtra('')
  }

  async function addRule(unitId: string) {
    let config: any = null
    if (ruleDraftType === 'tiered_price') {
      const tiers = tierRows
        .map(r => ({ min_qty: parseFloat(r.min_qty), price: parseFloat(r.price) }))
        .filter(r => Number.isFinite(r.min_qty) && r.min_qty > 0 && Number.isFinite(r.price) && r.price >= 0)
      if (tiers.length === 0) { showToast('Add at least one tier with valid qty + price', 'error'); return }
      config = { tiers }
    } else {
      const buy = parseFloat(bonusBuy); const extra = parseFloat(bonusExtra)
      if (!Number.isFinite(buy) || buy <= 0 || !Number.isFinite(extra) || extra <= 0) {
        showToast('Buy and Extra must both be > 0', 'error')
        return
      }
      config = { buy, get_extra: extra }
    }
    const res = await fetch(`${baseUrl}/${unitId}/rules`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule_type: ruleDraftType, config, is_active: true }),
    })
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Failed to add rule', 'error'); return }
    await load()
    setTierRows([{ min_qty: '', price: '' }])
    setBonusBuy('')
    setBonusExtra('')
  }

  async function deleteRule(rule: UnitRule) {
    const ok = await showConfirm({
      title: 'Delete rule',
      message: `Delete this ${rule.rule_type.replace(/_/g, ' ')} rule?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`${baseUrl}/${rule.product_unit_id}/rules/${rule.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Failed to delete rule', 'error'); return }
    await load()
  }

  if (loading) {
    return <div className="text-xs text-foreground-muted py-3">Loading units…</div>
  }

  return (
    <div className="border-t border-border-default pt-4 mt-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-secondary">Selling Units</h4>
        <span className="text-[10px] text-foreground-muted">Stock + base price live in the BASE unit. Other units are multipliers.</span>
      </div>

      {units.length === 0 ? (
        <p className="text-xs text-foreground-muted italic">No units configured. Add one below.</p>
      ) : (
        <div className="bg-surface-elevated border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-secondary text-[10px] uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-right">Factor</th>
                <th className="px-3 py-2 text-right">Price ovrd.</th>
                <th className="px-3 py-2 text-center">Base</th>
                <th className="px-3 py-2 text-center">Sell def.</th>
                <th className="px-3 py-2 text-center">Buy def.</th>
                <th className="px-3 py-2 text-right">Rules</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {units.map(u => {
                const unitRules = rulesFor(u.id)
                const expanded = expandedUnitId === u.id
                return (
                  <>
                    <tr key={u.id} className="hover:bg-surface-secondary/40">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {u.unit}
                        {u.display_label && <p className="text-[10px] text-foreground-muted mt-0.5">{u.display_label}</p>}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground-secondary">{Number(u.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
                      <td className="px-3 py-2 text-right text-foreground-secondary">{u.price_override != null ? `₹${Number(u.price_override).toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-2 text-center">
                        {u.is_base ? <span className="text-[10px] font-bold text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">BASE</span>
                          : <button type="button" onClick={() => setFlag(u, 'is_base')} className="text-[10px] text-accent-600 hover:underline">make base</button>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {u.is_sell_default ? <span className="text-[10px] font-bold text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">DEFAULT</span>
                          : <button type="button" onClick={() => setFlag(u, 'is_sell_default')} className="text-[10px] text-accent-600 hover:underline">set</button>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {u.is_purchase_default ? <span className="text-[10px] font-bold text-purple-700 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 px-2 py-0.5 rounded-full">DEFAULT</span>
                          : <button type="button" onClick={() => setFlag(u, 'is_purchase_default')} className="text-[10px] text-accent-600 hover:underline">set</button>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setExpandedUnitId(expanded ? null : u.id)} className="text-[10px] text-foreground-secondary hover:text-foreground hover:underline">
                          {unitRules.length} rule{unitRules.length !== 1 ? 's' : ''} {expanded ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!u.is_base && (
                          <button type="button" onClick={() => deleteUnit(u)} className="text-[10px] text-red-500 hover:text-red-600">Delete</button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${u.id}-rules`}>
                        <td colSpan={8} className="px-3 py-3 bg-surface-secondary/30">
                          <div className="space-y-3">
                            {unitRules.length > 0 && (
                              <div className="space-y-1">
                                {unitRules.map(r => (
                                  <div key={r.id} className="flex items-center justify-between gap-2 bg-surface px-3 py-2 rounded border border-border-default text-xs">
                                    <div className="flex-1 min-w-0">
                                      <span className="font-semibold text-foreground capitalize">{r.rule_type.replace(/_/g, ' ')}</span>
                                      <code className="ml-2 text-[10px] font-mono text-foreground-muted break-all">{JSON.stringify(r.config)}</code>
                                    </div>
                                    <button type="button" onClick={() => deleteRule(r)} className="text-[10px] text-red-500 hover:text-red-600 shrink-0">Remove</button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="bg-surface border border-border-default rounded-lg p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] uppercase tracking-wide text-foreground-muted">Add rule</label>
                                <select value={ruleDraftType} onChange={e => setRuleDraftType(e.target.value as any)} className="text-xs px-2 py-1 border border-border-secondary rounded bg-surface text-foreground">
                                  <option value="tiered_price">Tiered price</option>
                                  <option value="bonus_qty">Bonus qty (buy N, get extra)</option>
                                </select>
                              </div>

                              {ruleDraftType === 'tiered_price' && (
                                <div className="space-y-1.5">
                                  {tierRows.map((row, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                                      <input type="number" placeholder={`Min qty (${u.unit})`} value={row.min_qty} onChange={e => setTierRows(rows => rows.map((r, idx) => idx === i ? { ...r, min_qty: e.target.value } : r))} className={inputCls} />
                                      <input type="number" step="0.01" placeholder="Price ex-GST" value={row.price} onChange={e => setTierRows(rows => rows.map((r, idx) => idx === i ? { ...r, price: e.target.value } : r))} className={inputCls} />
                                      <button type="button" onClick={() => setTierRows(rows => rows.filter((_, idx) => idx !== i))} className="text-[10px] text-red-500 hover:text-red-600 px-2">×</button>
                                    </div>
                                  ))}
                                  <button type="button" onClick={() => setTierRows(rows => [...rows, { min_qty: '', price: '' }])} className="text-[10px] text-accent-600 hover:underline">+ tier</button>
                                </div>
                              )}

                              {ruleDraftType === 'bonus_qty' && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] text-foreground-muted mb-0.5">Buy ({u.unit})</label>
                                    <input type="number" value={bonusBuy} onChange={e => setBonusBuy(e.target.value)} className={inputCls} placeholder="e.g. 100" />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-foreground-muted mb-0.5">Get extra (free)</label>
                                    <input type="number" value={bonusExtra} onChange={e => setBonusExtra(e.target.value)} className={inputCls} placeholder="e.g. 10" />
                                  </div>
                                </div>
                              )}

                              <div className="flex justify-end">
                                <button type="button" onClick={() => addRule(u.id)} className="px-3 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded">
                                  + Add Rule
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleAdd} className="bg-surface border border-border-default rounded-lg p-3">
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">Add a unit (multiplier into base unit)</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div>
            <label className="block text-[10px] text-foreground-muted mb-0.5">Unit *</label>
            <input value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} className={inputCls} placeholder={baseUnitName ? `vs ${baseUnitName}` : 'e.g. box'} />
          </div>
          <div>
            <label className="block text-[10px] text-foreground-muted mb-0.5">Factor *</label>
            <input type="number" step="0.0001" value={draft.factor} onChange={e => setDraft(d => ({ ...d, factor: e.target.value }))} className={inputCls} placeholder="100" />
          </div>
          <div>
            <label className="block text-[10px] text-foreground-muted mb-0.5">Label</label>
            <input value={draft.display_label} onChange={e => setDraft(d => ({ ...d, display_label: e.target.value }))} className={inputCls} placeholder="Box of 100 pcs" />
          </div>
          <div>
            <label className="block text-[10px] text-foreground-muted mb-0.5">Price override</label>
            <input type="number" step="0.01" value={draft.price_override} onChange={e => setDraft(d => ({ ...d, price_override: e.target.value }))} className={inputCls} placeholder="optional" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={saving} className="px-3 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-50 w-full">
              {saving ? 'Saving…' : '+ Add Unit'}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2 text-[11px] text-foreground-secondary">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={draft.is_sell_default} onChange={e => setDraft(d => ({ ...d, is_sell_default: e.target.checked }))} />
            Make sell default
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={draft.is_purchase_default} onChange={e => setDraft(d => ({ ...d, is_purchase_default: e.target.checked }))} />
            Make purchase default
          </label>
        </div>
      </form>
    </div>
  )
}
