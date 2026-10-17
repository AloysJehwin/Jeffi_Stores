'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Trash2 } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { StatusBadge, ACTIVE_STATUS, badgeCls } from '@/components/admin/kit'

interface CouponRow {
  id: string
  code: string
  description: string | null
  discount_type: string
  discount_value: number
  min_purchase_amount: number | null
  usage_limit: number | null
  times_used: number
  valid_until: string | null
  is_active: boolean
  generated_for_campaign: string | null
}

interface Props {
  coupons: CouponRow[]
  backUrl: string
}

function discountLabel(c: CouponRow) {
  return c.discount_type === 'percentage' ? `${c.discount_value}% off` : `Rs. ${c.discount_value} off`
}

export default function CouponsMobileList({ coupons, backUrl }: Props) {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useHasScope('coupons:write')

  const [selected, setSelected] = useState<CouponRow | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function deleteCoupon(c: CouponRow) {
    const ok = await confirm({
      title: 'Delete Coupon',
      message: `Delete coupon "${c.code}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/coupons/${c.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to delete coupon', 'error')
        return
      }
      setSelected(null)
      showToast(`Coupon "${c.code}" deleted`, 'success')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function buildActions(c: CouponRow): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View coupon',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/coupons/${c.id}?back=${encodeURIComponent(backUrl)}`)),
      },
    ]
    if (canWrite) {
      actions.push({
        key: 'delete',
        label: 'Delete coupon',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        disabled: busy,
        onSelect: () => deleteCoupon(c),
      })
    }
    return actions
  }

  return (
    <div className="space-y-2">
      {coupons.map(c => (
        <div key={c.id}>
          <MobileListCard ariaLabel={`Open ${c.code}`} onTap={() => setSelected(c)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono font-bold text-accent-500 truncate">{c.code}</div>
                {c.generated_for_campaign && (
                  <span className={`${badgeCls('blue')} mt-1 w-fit`}>{c.generated_for_campaign}</span>
                )}
              </div>
              <StatusBadge status={String(c.is_active)} map={ACTIVE_STATUS} />
            </div>
            {c.description && <p className="text-sm text-foreground-secondary mt-2 line-clamp-2">{c.description}</p>}
            <div className="text-xs text-foreground-muted mt-1">
              {discountLabel(c)}
              {c.valid_until && ` · Expires ${new Date(c.valid_until).toLocaleDateString('en-IN')}`}
            </div>
          </MobileListCard>
        </div>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.code}
        subtitle={selected ? discountLabel(selected) : undefined}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="control-md w-full bg-accent-500 font-semibold text-white hover:bg-accent-600"
          >
            Actions
          </button>
        }
      >
        {selected && (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={String(selected.is_active)} map={ACTIVE_STATUS} />
              {selected.generated_for_campaign && (
                <span className={badgeCls('blue')}>{selected.generated_for_campaign}</span>
              )}
            </div>
            {selected.description && <p className="text-sm text-foreground">{selected.description}</p>}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-default pt-4">
              <div>
                <p className="text-xs text-foreground-muted">Discount</p>
                <p className="text-sm text-foreground font-medium">{discountLabel(selected)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Min. purchase</p>
                <p className="text-sm text-foreground font-medium">
                  {selected.min_purchase_amount ? `Rs. ${selected.min_purchase_amount}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Usage</p>
                <p className="text-sm text-foreground font-medium">
                  {selected.times_used}
                  {selected.usage_limit ? ` / ${selected.usage_limit}` : ''}
                </p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Expires</p>
                <p className="text-sm text-foreground font-medium">
                  {selected.valid_until ? new Date(selected.valid_until).toLocaleDateString('en-IN') : 'No expiry'}
                </p>
              </div>
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.code}
        actions={selected ? buildActions(selected) : []}
      />
    </div>
  )
}
