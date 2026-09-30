'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Pencil, Star, Tag, Power, Trash2 } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import ProductMobileCardBody from './ProductMobileCardBody'
import ProductMobileDetailBody from './ProductMobileDetailBody'
import ProductLabelModal from './ProductLabelModal'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'

interface Props {
  products: any[]
  featuredCount: number
  backUrl: string
  isSuperAdmin: boolean
  canWrite: boolean
}

export default function ProductsMobileList({
  products,
  featuredCount,
  backUrl,
  isSuperAdmin,
  canWrite,
}: Props) {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canLabels = useHasScope('labels:read')

  const [selected, setSelected] = useState<any>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [labelProduct, setLabelProduct] = useState<{ id: string; name: string; has_variants: boolean } | null>(null)
  const [draftProduct, setDraftProduct] = useState<{ id: string; name: string; sku: string | null } | null>(null)
  const [overrides, setOverrides] = useState<Record<string, { is_active?: boolean; is_featured?: boolean }>>({})
  const [busy, setBusy] = useState(false)

  const merge = (product: any) => ({ ...product, ...overrides[product.id] })

  async function patchProduct(product: any, patch: Record<string, unknown>, label: string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || `Failed to ${label}`, 'error')
        return
      }
      setOverrides(prev => ({ ...prev, [product.id]: { ...prev[product.id], ...patch } }))
      setSelected((cur: any) => (cur && cur.id === product.id ? { ...cur, ...patch } : cur))
      showToast(`${product.name} updated`, 'success')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(product: any) {
    const next = !(product.is_active as boolean)
    const ok = await confirm({
      title: next ? 'Activate Product' : 'Deactivate Product',
      message: next
        ? `Activate "${product.name}"? It will become visible to customers.`
        : `Deactivate "${product.name}"? It will no longer be visible to customers.`,
      confirmLabel: next ? 'Activate' : 'Deactivate',
      variant: next ? 'default' : 'danger',
    })
    if (!ok) return
    await patchProduct(product, { is_active: next }, 'update status')
  }

  async function toggleFeatured(product: any) {
    const next = !(product.is_featured as boolean)
    if (next && featuredCount >= 6) {
      showToast('Max 6 featured products. Unfeature one first.', 'warning')
      return
    }
    await patchProduct(product, { is_featured: next }, 'update featured')
  }

  async function deleteProduct(product: any) {
    const ok = await confirm({
      message: `Permanently delete "${product.name}"? This cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSelected(null)
        showToast(`${product.name} deleted`, 'success')
        router.refresh()
      } else {
        showToast(data.error || 'Failed to delete product.', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  function buildActions(product: any): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View full product',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/products/${product.id}`)),
      },
    ]
    if (canWrite) {
      actions.push({
        key: 'edit',
        label: 'Edit product',
        icon: <Pencil className="w-4 h-4" />,
        onSelect: () => {
          if (product.is_active) {
            setDraftProduct({ id: product.id, name: String(product.name || ''), sku: product.sku ? String(product.sku) : null })
          } else {
            router.push(ap(`/admin/products/edit/${product.id}?back=${encodeURIComponent(backUrl)}`))
          }
        },
      })
      actions.push({
        key: 'feature',
        label: product.is_featured ? 'Remove from featured' : 'Mark as featured',
        icon: <Star className={`w-4 h-4 ${product.is_featured ? 'fill-current' : ''}`} />,
        disabled: busy,
        onSelect: () => toggleFeatured(product),
      })
      actions.push({
        key: 'active',
        label: product.is_active ? 'Deactivate' : 'Activate',
        icon: <Power className="w-4 h-4" />,
        disabled: busy,
        onSelect: () => toggleActive(product),
      })
    }
    if (canLabels) {
      actions.push({
        key: 'label',
        label: 'Print label',
        icon: <Tag className="w-4 h-4" />,
        onSelect: () => setLabelProduct({ id: product.id, name: product.name, has_variants: product.has_variants }),
      })
    }
    if (isSuperAdmin && canWrite) {
      actions.push({
        key: 'delete',
        label: 'Delete product',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        disabled: busy,
        onSelect: () => deleteProduct(product),
      })
    }
    return actions
  }

  const selectedMerged = selected ? merge(selected) : null

  return (
    <div className="space-y-3">
      {products.map(raw => {
        const product = merge(raw)
        return (
          <MobileListCard
            key={product.id}
            accent={product.is_featured}
            ariaLabel={`Open ${product.name}`}
            onTap={() => setSelected(product)}
          >
            <ProductMobileCardBody product={product} />
          </MobileListCard>
        )
      })}

      <MobileDetailSheet
        open={!!selectedMerged}
        onClose={() => setSelected(null)}
        title={selectedMerged?.name}
        subtitle={selectedMerged?.sku}
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
        {selectedMerged && <ProductMobileDetailBody product={selectedMerged} />}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selectedMerged}
        onClose={() => setActionsOpen(false)}
        title={selectedMerged?.name}
        actions={selectedMerged ? buildActions(selectedMerged) : []}
      />

      <ProductLabelModal product={labelProduct} onClose={() => setLabelProduct(null)} />
      {draftProduct && (
        <DraftConfirmModal
          productId={draftProduct.id}
          productName={draftProduct.name}
          productSku={draftProduct.sku}
          existingDraftId={null}
          backUrl={backUrl}
          onClose={() => setDraftProduct(null)}
        />
      )}
    </div>
  )
}
