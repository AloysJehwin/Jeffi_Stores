'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

export interface ProductUnitRule {
  id: string
  product_unit_id: string
  rule_type: string
  config: any
  is_active: boolean
  priority: number
}

interface Props {
  productId: string
  unitId: string
  unitVariantId: string | null
  rules: ProductUnitRule[]
  unitLabel: string
  onChanged: () => void | Promise<void>
}

const inputCls =
  'px-2 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-sm focus:ring-1 focus:ring-accent-500 w-full h-[34px]'

// Rules live on the unit row. Product-level units (variant_id IS NULL) use the
// product rules endpoint; variant-level units use the variant rules endpoint.
// When a variant inherits from product, the returned unit rows are product-level,
// so we route via unit.variant_id, not the page's variantId prop.
function rulesUrl(productId: string, unitId: string, unitVariantId: string | null) {
  return unitVariantId
    ? `/api/admin/products/${productId}/variants/${unitVariantId}/units/${unitId}/rules`
    : `/api/admin/products/${productId}/units/${unitId}/rules`
}

interface Tier {
  min_qty: number
  price: number
}

export default function UnitRulesPanel({ productId, unitId, unitVariantId, rules, unitLabel, onChanged }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('inventory')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [minQty, setMinQty] = useState('')
  const [price, setPrice] = useState('')

  const tieredRules = rules.filter(r => r.rule_type === 'tiered_price')

  async function addTier() {
    const minQtyNum = parseFloat(minQty)
    const priceNum = parseFloat(price)
    if (!Number.isFinite(minQtyNum) || minQtyNum <= 0) {
      showToast('Min qty must be > 0', 'error')
      return
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      showToast('Price must be >= 0', 'error')
      return
    }

    setBusy(true)
    try {
      const res = await fetch(rulesUrl(productId, unitId, unitVariantId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_type: 'tiered_price',
          config: { tiers: [{ min_qty: minQtyNum, price: priceNum }] },
          is_active: true,
          priority: 0,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Failed to add tier', 'error')
        return
      }
      setMinQty('')
      setPrice('')
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(rule: ProductUnitRule) {
    setBusy(true)
    try {
      const res = await fetch(`${rulesUrl(productId, unitId, unitVariantId)}/${rule.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !rule.is_active }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Failed to update', 'error')
        return
      }
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function deleteRule(rule: ProductUnitRule) {
    const ok = await confirm({ message: 'Delete this pricing rule?', variant: 'danger', confirmLabel: 'Delete' })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`${rulesUrl(productId, unitId, unitVariantId)}/${rule.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Failed to delete', 'error')
        return
      }
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-border-default rounded-lg bg-surface">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-wide text-foreground-secondary">
          Tiered Pricing
          <span className="ml-2 text-[10px] font-normal normal-case text-foreground-muted">
            {tieredRules.length === 0
              ? 'no tiers — flat price'
              : `${tieredRules.length} tier${tieredRules.length === 1 ? '' : 's'}`}
          </span>
        </span>
        <span className="text-foreground-muted text-xs">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border-default pt-2">
          {tieredRules.length === 0 ? (
            <p className="text-[11px] text-foreground-muted italic">
              No bulk discount tiers. Add one below to give a lower price at higher quantities.
            </p>
          ) : (
            <div className="space-y-1">
              {tieredRules.map(rule => {
                const tiers: Tier[] = Array.isArray(rule.config?.tiers) ? rule.config.tiers : []
                return (
                  <div
                    key={rule.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
                      rule.is_active
                        ? 'border-border-default bg-surface-elevated'
                        : 'border-dashed border-border-secondary bg-surface opacity-60'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-accent-500/10 text-accent-600 px-1.5 py-0.5 rounded">
                      {rule.rule_type}
                    </span>
                    <span className="text-[11px] text-foreground flex-1">
                      {tiers.length === 0 ? (
                        <span className="italic text-foreground-muted">empty config</span>
                      ) : (
                        tiers.map((t, i) => (
                          <span key={i} className="mr-2">
                            ≥{t.min_qty} {unitLabel}: ₹
                            {Number(t.price).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        ))
                      )}
                    </span>
                    <span className="text-[10px] text-foreground-muted">p{rule.priority}</span>
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleActive(rule)}
                          disabled={busy}
                          className={`text-[10px] px-2 py-0.5 rounded border disabled:opacity-50 ${
                            rule.is_active
                              ? 'border-green-500/40 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20'
                              : 'border-border-secondary text-foreground-muted'
                          }`}
                          title={rule.is_active ? 'Active — click to disable' : 'Inactive — click to enable'}
                        >
                          {rule.is_active ? 'on' : 'off'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(rule)}
                          disabled={busy}
                          className="text-[10px] text-red-600 hover:underline disabled:opacity-50"
                        >
                          delete
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {canWrite && (
            <>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end pt-1">
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Min qty</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={minQty}
                    onChange={e => setMinQty(e.target.value)}
                    className={inputCls}
                    placeholder={`e.g. 10 ${unitLabel}`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Price (ex GST)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    className={inputCls}
                    placeholder={`per ${unitLabel}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={addTier}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-50 h-[34px]"
                >
                  + Add Tier
                </button>
              </div>
              <p className="text-[10px] text-foreground-muted">
                Price applies when ordered qty is ≥ min qty. Highest matching tier wins (lowest priority number first).
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
