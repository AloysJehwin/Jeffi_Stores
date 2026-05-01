'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
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

interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  display_order: number
  is_active: boolean
  parent_category_id: string | null
}

function DragHandle({ attributes, listeners }: { attributes: any; listeners: any }) {
  return (
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
  )
}

function SortableRow({
  category,
  isSubcat,
  collapsed,
  onToggleCollapse,
  subCount,
}: {
  category: Category
  isSubcat: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  subCount?: number
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
          <DragHandle attributes={attributes} listeners={listeners} />
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
          <div>
            <div className={`text-sm ${isSubcat ? 'text-foreground' : 'font-semibold text-foreground'}`}>
              {category.name}
            </div>
            {category.description && (
              <div className="text-xs text-foreground-muted">{category.description}</div>
            )}
          </div>
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
        <DeleteCategoryButton categoryId={category.id} categoryName={category.name} />
      </td>
    </tr>
  )
}

function SortableMobileCard({
  category,
  isSubcat,
  collapsed,
  onToggleCollapse,
  subCount,
}: {
  category: Category
  isSubcat: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  subCount?: number
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
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 ${isSubcat ? 'ml-6' : ''}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <DragHandle attributes={attributes} listeners={listeners} />
          {!isSubcat && subCount !== undefined && subCount > 0 && (
            <button onClick={onToggleCollapse} className="text-foreground-muted">
              <svg className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          <div className="text-sm font-semibold text-foreground">
            {isSubcat && <span className="text-foreground-muted mr-1">└</span>}
            {category.name}
          </div>
          {!isSubcat && subCount !== undefined && subCount > 0 && (
            <span className="text-xs text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded-full">{subCount}</span>
          )}
        </div>
        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${category.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-surface-secondary text-foreground'}`}>
          {category.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-foreground-muted mb-3">
        <span>{category.slug}</span>
        <span>Order: {category.display_order}</span>
      </div>
      <div className="flex items-center justify-end gap-3 text-sm">
        <Link href={`/admin/categories/edit/${category.id}`} className="text-accent-500 font-medium">Edit</Link>
        <DeleteCategoryButton categoryId={category.id} categoryName={category.name} />
      </div>
    </div>
  )
}

export default function CategoriesClient({ initialCategories }: { initialCategories: Category[] }) {
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

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

    if (isMainDragged && !overIsMain) return
    if (!isMainDragged && (!sameParent)) return

    const updated = [...categories]

    if (isMainDragged) {
      const mains = updated.filter(c => !c.parent_category_id).sort((a, b) => a.display_order - b.display_order)
      const fromIdx = mains.findIndex(c => c.id === activeId)
      const toIdx = mains.findIndex(c => c.id === overId)
      const reordered = arrayMove(mains, fromIdx, toIdx)
      reordered.forEach((c, i) => {
        const idx = updated.findIndex(u => u.id === c.id)
        updated[idx] = { ...updated[idx], display_order: i + 1 }
      })
    } else {
      const siblings = updated.filter(c => c.parent_category_id === activeCat.parent_category_id).sort((a, b) => a.display_order - b.display_order)
      const fromIdx = siblings.findIndex(c => c.id === activeId)
      const toIdx = siblings.findIndex(c => c.id === overId)
      const reordered = arrayMove(siblings, fromIdx, toIdx)
      reordered.forEach((c, i) => {
        const idx = updated.findIndex(u => u.id === c.id)
        updated[idx] = { ...updated[idx], display_order: i + 1 }
      })
    }

    setCategories(updated)
    saveReorder(updated)
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

          {/* Desktop table */}
          <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
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
                      />
                      {!isCollapsed && subcats.map(sub => (
                        <SortableRow
                          key={sub.id}
                          category={sub}
                          isSubcat={true}
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

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {mainCategories.length > 0 ? mainCategories.map(cat => {
              const subcats = getSubcats(cat.id)
              const isCollapsed = collapsed.has(cat.id)
              return (
                <div key={cat.id}>
                  <SortableMobileCard
                    category={cat}
                    isSubcat={false}
                    collapsed={isCollapsed}
                    onToggleCollapse={() => toggleCollapse(cat.id)}
                    subCount={subcats.length}
                  />
                  {!isCollapsed && subcats.map(sub => (
                    <div key={sub.id} className="mt-2">
                      <SortableMobileCard category={sub} isSubcat={true} />
                    </div>
                  ))}
                </div>
              )
            }) : (
              <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
                No categories found.
              </div>
            )}
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
    </div>
  )
}
