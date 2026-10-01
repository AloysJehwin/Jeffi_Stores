'use client'

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Pencil, Power, Trash2, ChevronRight } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'
import CategoryMobileCardBody from './CategoryMobileCardBody'
import CategoryMobileDetailBody from './CategoryMobileDetailBody'

interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  icon_name: string | null
  display_order: number
  is_active: boolean
  parent_category_id: string | null
  sku_prefix?: string | null
  return_allowed?: boolean | null
  return_window_days?: number | null
  replacement_allowed?: boolean | null
  replacement_window_days?: number | null
}

interface Props {
  typeFilter: string
  pagedMain: Category[]
  pagedSubOnly: Category[]
  getSubcats: (parentId: string) => Category[]
  query: string
  collapsed: Set<string>
  onToggleCollapse: (id: string) => void
  categoriesById: Map<string, Category>
  productCounts: Record<string, number>
  backUrl: string
  onToggleStatus: (category: Category) => void
  onDeleted: (id: string) => void
}

export default function CategoriesMobileList({
  typeFilter,
  pagedMain,
  pagedSubOnly,
  getSubcats,
  query,
  collapsed,
  onToggleCollapse,
  categoriesById,
  productCounts,
  backUrl,
  onToggleStatus,
  onDeleted,
}: Props) {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useHasScope('categories:write')

  const [selected, setSelected] = useState<Category | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function deleteCategory(category: Category) {
    const ok = await confirm({
      title: 'Delete Category',
      message: `Delete "${category.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to delete category. Please try again.', 'error')
        return
      }
      setSelected(null)
      showToast(`"${category.name}" deleted successfully.`, 'success')
      onDeleted(category.id)
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  function buildActions(category: Category): MobileAction[] {
    const current = categoriesById.get(category.id) ?? category
    const actions: MobileAction[] = []
    if (canWrite) {
      actions.push({
        key: 'edit',
        label: 'Edit category',
        icon: <Pencil className="w-4 h-4" />,
        onSelect: () => setEditCategory(current),
      })
      actions.push({
        key: 'active',
        label: current.is_active ? 'Deactivate' : 'Activate',
        icon: <Power className="w-4 h-4" />,
        onSelect: () => onToggleStatus(current),
      })
      actions.push({
        key: 'delete',
        label: 'Delete category',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        disabled: deleting,
        onSelect: () => deleteCategory(current),
      })
    }
    return actions
  }

  function renderCard(category: Category, isSubcat: boolean, subCount?: number) {
    const current = categoriesById.get(category.id) ?? category
    return (
      <MobileListCard
        ariaLabel={`Open ${current.name}`}
        onTap={() => setSelected(current)}
      >
        <CategoryMobileCardBody category={current} isSubcat={isSubcat} subCount={subCount} />
      </MobileListCard>
    )
  }

  const selectedParentName = selected?.parent_category_id
    ? categoriesById.get(selected.parent_category_id)?.name ?? null
    : null
  const selectedSubCount = selected && !selected.parent_category_id ? getSubcats(selected.id).length : undefined

  return (
    <>
      <div className="space-y-3">
        {typeFilter === 'sub'
          ? pagedSubOnly.map(sub => <Fragment key={sub.id}>{renderCard(sub, true)}</Fragment>)
          : pagedMain.map(cat => {
              const subcats = getSubcats(cat.id)
              const visibleSubcats = query
                ? subcats.filter(
                    s => s.name.toLowerCase().includes(query) || s.slug.toLowerCase().includes(query)
                  )
                : subcats
              const isCollapsed = collapsed.has(cat.id)
              return (
                <div key={cat.id} className="space-y-2">
                  <div className="relative">
                    {renderCard(cat, false, subcats.length)}
                    {subcats.length > 0 && (
                      <button
                        type="button"
                        aria-label={isCollapsed ? 'Expand subcategories' : 'Collapse subcategories'}
                        onClick={() => onToggleCollapse(cat.id)}
                        className="absolute left-1 top-1 p-1 text-foreground-muted"
                      >
                        <ChevronRight className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                      </button>
                    )}
                  </div>
                  {!isCollapsed &&
                    visibleSubcats.map(sub => (
                      <div key={sub.id} className="ml-6">
                        {renderCard(sub, true)}
                      </div>
                    ))}
                </div>
              )
            })}
      </div>

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={selected?.slug}
        footer={
          canWrite ? (
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
            >
              Actions
            </button>
          ) : undefined
        }
      >
        {selected && (
          <CategoryMobileDetailBody
            category={selected}
            parentName={selectedParentName}
            subCount={selectedSubCount}
            productCount={productCounts[selected.id]}
          />
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.name}
        actions={selected ? buildActions(selected) : []}
      />

      {editCategory && (
        <DraftConfirmModal
          entity="categories"
          productId={editCategory.id}
          productName={editCategory.name}
          productSku={null}
          existingDraftId={null}
          backUrl={backUrl}
          onClose={() => setEditCategory(null)}
        />
      )}
    </>
  )
}
