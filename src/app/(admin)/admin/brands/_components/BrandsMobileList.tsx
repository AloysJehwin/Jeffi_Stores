'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Pencil, Power, Trash2, ExternalLink } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface Props {
  brands: any[]
  backUrl: string
}

export default function BrandsMobileList({ brands, backUrl }: Props) {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useHasScope('brands:write')

  const [selected, setSelected] = useState<any>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, { is_active?: boolean }>>({})
  const [busy, setBusy] = useState(false)

  const merge = (brand: any) => ({ ...brand, ...overrides[brand.id] })

  async function toggleActive(brand: any) {
    if (busy) return
    setBusy(true)
    const next = !(brand.is_active as boolean)
    try {
      const res = await fetch(`/api/admin/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: brand.name,
          slug: brand.slug,
          description: brand.description ?? null,
          website: brand.website ?? null,
          logo_url: null,
          is_active: next,
          return_allowed: brand.return_allowed,
          return_window_days: brand.return_window_days,
          replacement_allowed: brand.replacement_allowed,
          replacement_window_days: brand.replacement_window_days,
        }),
      })
      if (!res.ok) {
        showToast('Failed to update status', 'error')
        return
      }
      setOverrides(prev => ({ ...prev, [brand.id]: { ...prev[brand.id], is_active: next } }))
      setSelected((cur: any) => (cur && cur.id === brand.id ? { ...cur, is_active: next } : cur))
      showToast(`${brand.name} ${next ? 'activated' : 'deactivated'}`, 'success')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function deleteBrand(brand: any) {
    const ok = await confirm({
      title: 'Delete Brand',
      message: `Delete "${brand.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/brands/${brand.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to delete brand.', 'error')
        return
      }
      setSelected(null)
      showToast(`"${brand.name}" deleted successfully.`, 'success')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function buildActions(brand: any): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View brand',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/brands/${brand.id}`)),
      },
    ]
    if (canWrite) {
      actions.push({
        key: 'edit',
        label: 'Edit brand',
        icon: <Pencil className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/brands/edit/${brand.id}?back=${encodeURIComponent(backUrl)}`)),
      })
      actions.push({
        key: 'active',
        label: brand.is_active ? 'Deactivate' : 'Activate',
        icon: <Power className="w-4 h-4" />,
        disabled: busy,
        onSelect: () => toggleActive(brand),
      })
      actions.push({
        key: 'delete',
        label: 'Delete brand',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        disabled: busy,
        onSelect: () => deleteBrand(brand),
      })
    }
    return actions
  }

  const selectedMerged = selected ? merge(selected) : null

  return (
    <div className="space-y-3">
      {brands.map(raw => {
        const brand = merge(raw)
        return (
          <MobileListCard key={brand.id} ariaLabel={`Open ${brand.name}`} onTap={() => setSelected(brand)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground truncate">{brand.name}</div>
                <div className="text-xs text-foreground-muted truncate">{brand.slug}</div>
              </div>
              <span
                className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
                  brand.is_active
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground'
                }`}
              >
                {brand.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            {brand.description && (
              <div className="text-xs text-foreground-muted mt-2 line-clamp-2">{brand.description}</div>
            )}
          </MobileListCard>
        )
      })}

      <MobileDetailSheet
        open={!!selectedMerged}
        onClose={() => setSelected(null)}
        title={selectedMerged?.name}
        subtitle={selectedMerged?.slug}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            Actions
          </button>
        }
      >
        {selectedMerged && (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  selectedMerged.is_active
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground-muted'
                }`}
              >
                {selectedMerged.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <p className="text-xs text-foreground-muted">Slug</p>
                <p className="text-sm text-foreground font-medium break-all">{selectedMerged.slug || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Website</p>
                {selectedMerged.website ? (
                  <a
                    href={selectedMerged.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent-500 font-medium inline-flex items-center gap-1 break-all"
                  >
                    Visit <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <p className="text-sm text-foreground font-medium">—</p>
                )}
              </div>
            </div>
            {selectedMerged.description && (
              <div className="border-t border-border-default pt-4">
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Description</p>
                <p className="text-sm text-foreground leading-relaxed">{selectedMerged.description}</p>
              </div>
            )}
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selectedMerged}
        onClose={() => setActionsOpen(false)}
        title={selectedMerged?.name}
        actions={selectedMerged ? buildActions(selectedMerged) : []}
      />
    </div>
  )
}
