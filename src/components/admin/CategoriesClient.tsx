'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
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

interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  icon_name: string | null
  display_order: number
  is_active: boolean
  parent_category_id: string | null
  subCount?: number
}

function SortableRow({
  category,
  isSubcat,
  collapsed,
  onToggleCollapse,
  subCount,
  productCount,
  onDeleted,
}: {
  category: Category
  isSubcat: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  subCount?: number
  productCount?: number
  onDeleted?: () => void
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
      className={`${isSubcat ? 'bg-surface' : 'bg-surface-elevated'} hover:bg-surface-secondary`}
    >
      <td className="px-4 py-3 whitespace-nowrap">
        <div className={`flex items-center gap-2 ${isSubcat ? 'ml-8' : ''}`}>
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-foreground-muted hover:text-foreground p-1 rounded touch-none"
            title="Drag to reorder"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </button>
          {!isSubcat && (
            <button
              onClick={onToggleCollapse}
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
              <div>
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
            width="270px"
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
                <p className="text-xs text-foreground-secondary">{category.description}</p>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-foreground-muted">Slug</span>
                <span className="text-foreground font-mono">{category.slug}</span>
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
      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
        <Link href={`/admin/categories/edit/${category.id}`} className="text-accent-500 hover:text-accent-600 mr-4">
          Edit
        </Link>
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={flatOrder.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
            <div className="overflow-x-auto">
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
                      />
                      {!isCollapsed && subcats.map(sub => (
                        <SortableRow
                          key={sub.id}
                          category={sub}
                          isSubcat={true}
                          productCount={productCounts[sub.id] || 0}
                          onDeleted={() => handleCategoryDeleted(sub.id)}
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
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {subcats.length > 0 && (
                      <button onClick={() => toggleCollapse(cat.id)} className="text-foreground-muted">
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
                <div className="flex items-center justify-end gap-3 text-sm">
                  <Link href={`/admin/categories/edit/${cat.id}`} className="text-accent-500 font-medium">Edit</Link>
                  <DeleteCategoryButton categoryId={cat.id} categoryName={cat.name} onDeleted={() => handleCategoryDeleted(cat.id)} />
                </div>
              </div>

              {!isCollapsed && subcats.map(sub => (
                <div key={sub.id} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 ml-6 mt-2">
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
                  <div className="flex items-center justify-end gap-3 text-sm">
                    <Link href={`/admin/categories/edit/${sub.id}`} className="text-accent-500 font-medium">Edit</Link>
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
