'use client'

import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import DeleteCategoryButton from './DeleteCategoryButton'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import HoverCard from '@/components/ui/HoverCard'
import Toggle from '@/components/ui/Toggle'

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
  return_allowed?: boolean
  return_window_days?: number
  replacement_allowed?: boolean
  replacement_window_days?: number
  subCount?: number
}

function ViewModal({ category, subCount, productCount, onClose, onEdit }: {
  category: Category
  subCount?: number
  productCount?: number
  onClose: () => void
  onEdit: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-border-default">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
              <CategoryIcon iconName={category.icon_name} categoryName={category.name} className="w-5 h-5 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{category.name}</h2>
              <p className="text-xs text-foreground-muted font-mono mt-0.5">{category.slug}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-secondary text-sm">
            <div>
              <p className="text-xs text-foreground-muted">Status</p>
              <p className={`font-semibold mt-0.5 ${category.is_active ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}`}>
                {category.is_active ? 'Active' : 'Inactive'}
              </p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Display Order</p>
              <p className="font-semibold mt-0.5 text-foreground">{category.display_order}</p>
            </div>
            {subCount !== undefined && (
              <div>
                <p className="text-xs text-foreground-muted">Subcategories</p>
                <p className="font-semibold mt-0.5 text-foreground">{subCount}</p>
              </div>
            )}
            {productCount !== undefined && (
              <div>
                <p className="text-xs text-foreground-muted">Products</p>
                <p className="font-semibold mt-0.5 text-foreground">{productCount}</p>
              </div>
            )}
          </div>
          {category.description && (
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Description</p>
              <p className="text-sm text-foreground leading-relaxed">{category.description}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">Return &amp; Replacement Policy</p>
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-secondary text-sm">
              <div>
                <p className="text-xs text-foreground-muted">Returns</p>
                <p className={`font-semibold mt-0.5 ${category.return_allowed !== false ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {category.return_allowed !== false ? `${category.return_window_days ?? 7} days` : 'Not allowed'}
                </p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Replacement</p>
                <p className={`font-semibold mt-0.5 ${category.replacement_allowed !== false ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {category.replacement_allowed !== false ? `${category.replacement_window_days ?? 7} days` : 'Not allowed'}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-1 border-t border-border-default">
            <button
              onClick={() => { onClose(); onEdit() }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors"
            >
              Edit Category
            </button>
            <a
              href={`/categories/${category.slug}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border-secondary text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              View on Store
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function EditDrawer({ category, allCategories, onClose, onSaved }: {
  category: Category
  allCategories: Category[]
  onClose: () => void
  onSaved: (updated: Category) => void
}) {
  const [name, setName] = useState(category.name)
  const [description, setDescription] = useState(category.description ?? '')
  const [displayOrder, setDisplayOrder] = useState(String(category.display_order))
  const [isActive, setIsActive] = useState(category.is_active)
  const [returnAllowed, setReturnAllowed] = useState(category.return_allowed !== false)
  const [returnDays, setReturnDays] = useState(category.return_window_days ?? 7)
  const [replacementAllowed, setReplacementAllowed] = useState(category.replacement_allowed !== false)
  const [replacementDays, setReplacementDays] = useState(category.replacement_window_days ?? 7)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/categories/${category.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description || null,
          parent_id: category.parent_category_id || null,
          display_order: parseInt(displayOrder) || 0,
          sku_prefix: category.sku_prefix || null,
          is_active: isActive,
          google_product_category: null,
          icon_name: category.icon_name || null,
          return_allowed: returnAllowed,
          return_window_days: returnDays,
          replacement_allowed: replacementAllowed,
          replacement_window_days: replacementDays,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed') }
      const updated = await res.json()
      onSaved(updated)
    } catch (e: any) {
      setError(e.message || 'Save failed')
      setSaving(false)
    }
  }

  const mainCategories = allCategories.filter(c => !c.parent_category_id && c.id !== category.id)

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-surface-elevated shadow-2xl border-l border-border-default flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
          <h2 className="text-base font-bold text-foreground">Edit Category</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">Display Order</label>
            <input
              type="number"
              min={0}
              value={displayOrder}
              onChange={e => setDisplayOrder(e.target.value)}
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <Toggle id="drawer_is_active" checked={isActive} onChange={setIsActive} label="Active" />
          </div>

          <div className="border-t border-border-default pt-4">
            <p className="text-sm font-semibold text-foreground mb-3">Return &amp; Replacement Policy</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Toggle id="drawer_return_allowed" checked={returnAllowed} onChange={setReturnAllowed} label="Returns Allowed" />
              </div>
              {returnAllowed && (
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">Return window (days)</label>
                  <input
                    type="number" min={1} max={90} value={returnDays}
                    onChange={e => setReturnDays(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                  />
                </div>
              )}
              <div className="flex items-center gap-3">
                <Toggle id="drawer_replacement_allowed" checked={replacementAllowed} onChange={setReplacementAllowed} label="Replacement Allowed" />
              </div>
              {replacementAllowed && (
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">Replacement window (days)</label>
                  <input
                    type="number" min={1} max={90} value={replacementDays}
                    onChange={e => setReplacementDays(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border-default shrink-0 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-border-secondary rounded-lg text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

function SortableRow({
  category,
  isSubcat,
  collapsed,
  onToggleCollapse,
  subCount,
  productCount,
  onDeleted,
  onEdit,
  onView,
}: {
  category: Category
  isSubcat: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  subCount?: number
  productCount?: number
  onDeleted?: () => void
  onEdit?: () => void
  onView?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`${isSubcat ? 'bg-surface' : 'bg-surface-elevated'} hover:bg-surface-secondary cursor-pointer`}
      onClick={onView}
    >
      <td className="px-4 py-3 whitespace-nowrap">
        <div className={`flex items-center gap-2 ${isSubcat ? 'ml-8' : ''}`}>
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-foreground-muted hover:text-foreground p-1 rounded touch-none"
            title="Drag to reorder"
            onClick={e => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </button>
          {!isSubcat && (
            <button
              onClick={e => { e.stopPropagation(); onToggleCollapse?.() }}
              className="text-foreground-muted hover:text-foreground p-0.5 rounded transition-transform"
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <svg
                className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {isSubcat && <span className="text-foreground-muted text-sm mr-1">└</span>}
          <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${isSubcat ? 'bg-surface-secondary' : 'bg-accent-100 dark:bg-accent-900/30'}`}>
            <CategoryIcon
              iconName={category.icon_name}
              categoryName={category.name}
              className={`w-4 h-4 ${isSubcat ? 'text-foreground-muted' : 'text-accent-600 dark:text-accent-400'}`}
            />
          </div>
          <HoverCard
            trigger={
              <div onClick={e => e.stopPropagation()}>
                <a
                  href={`/categories/${category.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`text-sm hover:text-accent-500 hover:underline cursor-pointer ${isSubcat ? 'text-foreground' : 'font-semibold text-foreground'}`}
                  onClick={e => e.stopPropagation()}
                >
                  {category.name}
                </a>
                {category.description && (
                  <div className="text-xs text-foreground-muted max-w-xs truncate">{category.description}</div>
                )}
              </div>
            }
            side="bottom"
            align="left"
            width="320px"
          >
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2 pb-2 border-b border-border-default">
                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${isSubcat ? 'bg-surface-secondary' : 'bg-accent-100 dark:bg-accent-900/30'}`}>
                  <CategoryIcon
                    iconName={category.icon_name}
                    categoryName={category.name}
                    className={`w-4 h-4 ${isSubcat ? 'text-foreground-muted' : 'text-accent-600 dark:text-accent-400'}`}
                  />
                </div>
                <span className="text-sm font-semibold text-foreground">{category.name}</span>
              </div>
              {category.description && (
                <p className="text-xs text-foreground-secondary line-clamp-2">{category.description}</p>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-foreground-muted">Slug</span>
                <span className="text-foreground font-mono break-all">{category.slug}</span>
                <span className="text-foreground-muted">Status</span>
                <span className={category.is_active ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}>
                  {category.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-foreground-muted">Order</span>
                <span className="text-foreground">{category.display_order}</span>
                {!isSubcat && subCount !== undefined && (
                  <>
                    <span className="text-foreground-muted">Subcategories</span>
                    <span className="text-foreground">{subCount}</span>
                  </>
                )}
                {productCount !== undefined && (
                  <>
                    <span className="text-foreground-muted">Products</span>
                    <span className="text-foreground">{productCount}</span>
                  </>
                )}
                <span className="text-foreground-muted">Returns</span>
                <span className={category.return_allowed !== false ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                  {category.return_allowed !== false ? `${category.return_window_days ?? 7}d` : 'No'}
                </span>
                <span className="text-foreground-muted">Replacement</span>
                <span className={category.replacement_allowed !== false ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                  {category.replacement_allowed !== false ? `${category.replacement_window_days ?? 7}d` : 'No'}
                </span>
              </div>
              <a
                href={`/categories/${category.slug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-accent-500 hover:text-accent-600 pt-1"
                onClick={e => e.stopPropagation()}
              >
                View on store
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </HoverCard>
          {!isSubcat && subCount !== undefined && subCount > 0 && (
            <span className="text-xs text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded-full">
              {subCount}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground-secondary">{category.slug}</td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">{category.display_order}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
          category.is_active
            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
            : 'bg-surface-secondary text-foreground'
        }`}>
          {category.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium" onClick={e => e.stopPropagation()}>
        <button onClick={onEdit} className="text-accent-500 hover:text-accent-600 mr-4">
          Edit
        </button>
        <DeleteCategoryButton categoryId={category.id} categoryName={category.name} onDeleted={onDeleted} />
      </td>
    </tr>
  )
}

export default function CategoriesClient({ initialCategories, productCounts = {} }: { initialCategories: Category[], productCounts?: Record<string, number> }) {
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewCategory, setViewCategory] = useState<Category | null>(null)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const router = useRouter()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const mainCategories = categories.filter(c => !c.parent_category_id).sort((a, b) => a.display_order - b.display_order)
  const getSubcats = useCallback(
    (parentId: string) => categories.filter(c => c.parent_category_id === parentId).sort((a, b) => a.display_order - b.display_order),
    [categories]
  )

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const flatOrder = mainCategories.flatMap(m => [m, ...(collapsed.has(m.id) ? [] : getSubcats(m.id))])

  const saveReorder = async (updated: Category[]) => {
    setSaving(true)
    await fetch('/api/categories/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: updated.map(c => ({
          id: c.id,
          display_order: c.display_order,
          parent_category_id: c.parent_category_id ?? null,
        })),
      }),
    })
    setSaving(false)
    router.refresh()
  }

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as string)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    setActiveId(null)
    if (!over || active.id === over.id) return

    const activeId = active.id as string
    const overId = over.id as string
    const activeCat = categories.find(c => c.id === activeId)!
    const overCat = categories.find(c => c.id === overId)!

    const isMainDragged = !activeCat.parent_category_id
    const overIsMain = !overCat.parent_category_id
    const sameParent = activeCat.parent_category_id === overCat.parent_category_id

    const updated = [...categories]

    if (isMainDragged && overIsMain) {
      const mains = updated.filter(c => !c.parent_category_id).sort((a, b) => a.display_order - b.display_order)
      const reordered = arrayMove(mains, mains.findIndex(c => c.id === activeId), mains.findIndex(c => c.id === overId))
      reordered.forEach((c, i) => {
        updated[updated.findIndex(u => u.id === c.id)] = { ...c, display_order: i + 1 }
      })
      setCategories(updated)
      saveReorder(updated)
      return
    }

    if (!isMainDragged && sameParent) {
      const siblings = updated.filter(c => c.parent_category_id === activeCat.parent_category_id).sort((a, b) => a.display_order - b.display_order)
      const reordered = arrayMove(siblings, siblings.findIndex(c => c.id === activeId), siblings.findIndex(c => c.id === overId))
      reordered.forEach((c, i) => {
        updated[updated.findIndex(u => u.id === c.id)] = { ...c, display_order: i + 1 }
      })
      setCategories(updated)
      saveReorder(updated)
    }
  }

  const handleCategoryDeleted = (id: string) => {
    setCategories(prev => prev.filter(c => c.id !== id && c.parent_category_id !== id))
  }

  const handleSaved = (updated: Category) => {
    setCategories(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
    setEditCategory(null)
    router.refresh()
  }

  const activeCategory = categories.find(c => c.id === activeId)

  return (
    <div className="relative">
      {saving && (
        <div className="fixed bottom-4 right-4 z-50 bg-accent-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Saving order…
        </div>
      )}

      {viewCategory && typeof document !== 'undefined' && (
        <ViewModal
          category={viewCategory}
          subCount={getSubcats(viewCategory.id).length}
          productCount={productCounts[viewCategory.id]}
          onClose={() => setViewCategory(null)}
          onEdit={() => setEditCategory(viewCategory)}
        />
      )}

      {editCategory && typeof document !== 'undefined' && (
        <EditDrawer
          category={editCategory}
          allCategories={categories}
          onClose={() => setEditCategory(null)}
          onSaved={handleSaved}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={flatOrder.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="overflow-x-auto overflow-y-visible">
            <table className="min-w-full divide-y divide-border-default">
              <thead className="bg-surface-secondary">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Slug</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Order</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {mainCategories.length > 0 ? mainCategories.map(cat => {
                  const subcats = getSubcats(cat.id)
                  const isCollapsed = collapsed.has(cat.id)
                  return (
                    <>
                      <SortableRow
                        key={cat.id}
                        category={cat}
                        isSubcat={false}
                        collapsed={isCollapsed}
                        onToggleCollapse={() => toggleCollapse(cat.id)}
                        subCount={subcats.length}
                        productCount={subcats.reduce((sum, s) => sum + (productCounts[s.id] || 0), productCounts[cat.id] || 0)}
                        onDeleted={() => handleCategoryDeleted(cat.id)}
                        onEdit={() => setEditCategory(cat)}
                        onView={() => setViewCategory(cat)}
                      />
                      {!isCollapsed && subcats.map(sub => (
                        <SortableRow
                          key={sub.id}
                          category={sub}
                          isSubcat={true}
                          productCount={productCounts[sub.id] || 0}
                          onDeleted={() => handleCategoryDeleted(sub.id)}
                          onEdit={() => setEditCategory(sub)}
                          onView={() => setViewCategory(sub)}
                        />
                      ))}
                    </>
                  )
                }) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-foreground-muted">
                      No categories found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </SortableContext>

        <DragOverlay>
          {activeCategory && (
            <div className="bg-surface-elevated border border-accent-400 rounded-lg px-4 py-2 shadow-xl text-sm font-medium text-foreground opacity-90">
              {activeCategory.parent_category_id ? '└ ' : ''}{activeCategory.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div className="md:hidden space-y-3">
        {mainCategories.map(cat => {
          const subcats = getSubcats(cat.id)
          const isCollapsed = collapsed.has(cat.id)
          return (
            <div key={cat.id}>
              <div
                className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 cursor-pointer"
                onClick={() => setViewCategory(cat)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {subcats.length > 0 && (
                      <button onClick={e => { e.stopPropagation(); toggleCollapse(cat.id) }} className="text-foreground-muted">
                        <svg className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )}
                    <div className="w-7 h-7 rounded-md bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
                      <CategoryIcon iconName={cat.icon_name} categoryName={cat.name} className="w-4 h-4 text-accent-600 dark:text-accent-400" />
                    </div>
                    <div className="text-sm font-semibold text-foreground">{cat.name}</div>
                    {subcats.length > 0 && (
                      <span className="text-xs text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded-full">{subcats.length}</span>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${cat.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-surface-secondary text-foreground'}`}>
                    {cat.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-foreground-muted mb-3">
                  <span>{cat.slug}</span>
                  <span>Order: {cat.display_order}</span>
                </div>
                <div className="flex items-center justify-end gap-3 text-sm" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setEditCategory(cat)} className="text-accent-500 font-medium">Edit</button>
                  <DeleteCategoryButton categoryId={cat.id} categoryName={cat.name} onDeleted={() => handleCategoryDeleted(cat.id)} />
                </div>
              </div>

              {!isCollapsed && subcats.map(sub => (
                <div
                  key={sub.id}
                  className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 ml-6 mt-2 cursor-pointer"
                  onClick={() => setViewCategory(sub)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-sm text-foreground flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-surface-secondary flex items-center justify-center shrink-0">
                        <CategoryIcon iconName={sub.icon_name} categoryName={sub.name} className="w-3.5 h-3.5 text-foreground-muted" />
                      </div>
                      <span className="text-foreground-muted mr-1">└</span>{sub.name}
                    </div>
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${sub.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-surface-secondary text-foreground'}`}>
                      {sub.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-foreground-muted mb-3">
                    <span>{sub.slug}</span>
                    <span>Order: {sub.display_order}</span>
                  </div>
                  <div className="flex items-center justify-end gap-3 text-sm" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setEditCategory(sub)} className="text-accent-500 font-medium">Edit</button>
                    <DeleteCategoryButton categoryId={sub.id} categoryName={sub.name} onDeleted={() => handleCategoryDeleted(sub.id)} />
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
