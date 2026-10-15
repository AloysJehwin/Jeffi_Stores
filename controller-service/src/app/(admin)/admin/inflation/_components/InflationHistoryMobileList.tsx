'use client'

import { useState } from 'react'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface PriceSnapshot {
  mrp_ex_gst: number | null
  mrp: number | null
  price_ex_gst: number | null
  base_price: number | null
}

interface SnapshotVariant {
  id: string
  variant_name: string
  before: PriceSnapshot
  after: PriceSnapshot
}

interface SnapshotProduct {
  id: string
  name: string
  has_variants: boolean
  before: PriceSnapshot
  after: PriceSnapshot
  variants: SnapshotVariant[]
}

interface InflationLog {
  id: string
  category_name: string
  percentage: number
  applied_fields: string[]
  product_count: number
  applied_by: string
  applied_at: string
  snapshot: SnapshotProduct[] | null
  is_rollback: boolean
  rolled_back_at: string | null
  rolled_back_by: string | null
}

interface Props {
  logs: InflationLog[]
  canWrite: boolean
  rollingBack: string | null
  onRollback: (log: InflationLog) => void | Promise<void>
}

function fmt(val: number | null): string {
  if (val == null) return '-'
  return `₹${val.toFixed(2)}`
}

function dateTime(s: string) {
  const d = new Date(s)
  return `${d.toLocaleDateString('en-IN')} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}

export default function InflationHistoryMobileList({ logs, canWrite, rollingBack, onRollback }: Props) {
  const [active, setActive] = useState<InflationLog | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(log: InflationLog): MobileAction[] {
    const actions: MobileAction[] = []
    if (canWrite && !log.is_rollback && !log.rolled_back_at && log.snapshot) {
      actions.push({
        key: 'rollback',
        label: rollingBack === log.id ? 'Rolling back...' : 'Rollback price change',
        danger: true,
        disabled: rollingBack === log.id,
        onSelect: () => {
          setActive(null)
          onRollback(log)
        },
      })
    }
    return actions
  }

  return (
    <>
      {logs.map(log => (
        <MobileListCard
          key={log.id}
          ariaLabel={`Open ${log.category_name} inflation`}
          onTap={() => setActive(log)}
          className={log.rolled_back_at ? 'opacity-60' : ''}
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="font-medium text-foreground truncate">{log.category_name}</span>
                {log.is_rollback && (
                  <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 uppercase tracking-wide">
                    Rollback
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 font-semibold text-sm ${log.is_rollback ? 'text-orange-600 dark:text-orange-400' : 'text-accent-600 dark:text-accent-400'}`}
              >
                {log.is_rollback ? '−' : '+'}
                {log.percentage}%
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
              <span>{log.product_count} products</span>
              <span>{log.applied_by}</span>
            </div>
            <div className="text-xs text-foreground-muted">{dateTime(log.applied_at)}</div>
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.category_name}
        subtitle={active ? `${active.is_rollback ? '−' : '+'}${active.percentage}% on ${active.product_count} products` : undefined}
        footer={
          active && buildActions(active).length > 0 ? (
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="w-full bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
            >
              Actions
            </button>
          ) : undefined
        }
      >
        {active && (
          <div className="px-5 py-4 space-y-4 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Applied by</span>
                <span className="text-foreground">{active.applied_by}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Date</span>
                <span className="text-foreground">{dateTime(active.applied_at)}</span>
              </div>
              {active.rolled_back_at && (
                <div className="flex justify-between">
                  <span className="text-foreground-secondary">Rolled back</span>
                  <span className="text-orange-600 dark:text-orange-400">
                    {new Date(active.rolled_back_at).toLocaleDateString('en-IN')}
                  </span>
                </div>
              )}
            </div>

            {active.snapshot && active.snapshot.length > 0 && (
              <div className="space-y-3 border-t border-border-default pt-3">
                <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wide">Price changes</p>
                {active.snapshot.map(p => (
                  <div key={p.id} className="rounded-lg border border-border-default p-3 space-y-1.5">
                    <p className="font-medium text-foreground">{p.name}</p>
                    {p.has_variants && p.variants.length > 0 ? (
                      p.variants.map(v => (
                        <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-foreground-secondary truncate">{v.variant_name}</span>
                          <span className="shrink-0">
                            <span className="text-foreground-muted line-through mr-1.5">{fmt(v.before.mrp_ex_gst)}</span>
                            <span className="text-green-600 dark:text-green-400 font-medium">{fmt(v.after.mrp_ex_gst)}</span>
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-foreground-secondary">MRP (Ex. GST)</span>
                        <span className="shrink-0">
                          <span className="text-foreground-muted line-through mr-1.5">{fmt(p.before.mrp_ex_gst)}</span>
                          <span className="text-green-600 dark:text-green-400 font-medium">{fmt(p.after.mrp_ex_gst)}</span>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!active}
        onClose={() => setActionsOpen(false)}
        title={active?.category_name}
        actions={active ? buildActions(active) : []}
      />
    </>
  )
}
