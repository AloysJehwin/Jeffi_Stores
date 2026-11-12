'use client'

import Link from 'next/link'
import { Sparkles, Star } from 'lucide-react'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/shared/admin-path'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { ACTIVE_STATUS, DetailHeader, StatusBadge, ViewDraftLink, badgeCls } from '@/components/admin/kit'
import type { HeldDraft } from './product-view'

const ghost = 'control-md border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary'

export function ProductHeader({
  p,
  heldDraft,
  canEnrich,
  onAi,
  onEdit,
}: {
  p: any
  heldDraft?: HeldDraft | null
  canEnrich: boolean
  onAi: () => void
  onEdit: () => void
}) {
  return (
    <DetailHeader
      back={{ href: ap('/admin/products'), label: 'Products' }}
      title={p.name}
      status={
        <>
          <StatusBadge status={String(!!p.is_active)} map={ACTIVE_STATUS} />
          {p.is_featured && (
            <span className={`${badgeCls('amber')} inline-flex items-center gap-1`}>
              <Star className="h-3 w-3 fill-current" /> Featured
            </span>
          )}
          <ProductWarningBadges fragile={p.fragile} hazardous={p.hazardous} flammable={p.flammable} />
        </>
      }
      subtitle={
        p.sku ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {p.sku}
            <CopySku sku={p.sku} />
          </span>
        ) : undefined
      }
      actions={
        <>
          {canEnrich && (
            <button type="button" onClick={onAi} className={ghost}>
              <Sparkles className="h-4 w-4 text-accent-500" />
              AI
            </button>
          )}
          <Link href={ap(`/admin/products/${p.id}/analytics`)} className={ghost}>
            Analytics
          </Link>
          {heldDraft ? (
            <ViewDraftLink held={heldDraft} />
          ) : (
            <RequireWrite scope="products:write">
              <button type="button" onClick={onEdit} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600">
                Edit
              </button>
            </RequireWrite>
          )}
        </>
      }
    />
  )
}
