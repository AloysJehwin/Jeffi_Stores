'use client'

import { useState, useCallback, useEffect, useMemo, Fragment } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import DraftEditButton from '@/components/admin/DraftEditButton'
import RowActions from '@/components/admin/RowActions'
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
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import CategoriesMobileList from './_components/CategoriesMobileList'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import HoverCard from '@/components/ui/HoverCard'
import Toggle from '@/components/ui/Toggle'
import { ap } from '@/lib/shared/admin-path'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { ACTIVE_STATUS, Dialog, EmptyState, Field, Fields, StatusBadge, badgeCls, useActionToast } from '@/components/admin/kit'
import { InfiniteFooter } from '@/components/admin/kit/infinite'

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
  subCount?: number
}

function ViewModal({
  category,
  subCount,
  productCount,
  onClose,
  backUrl = '/admin/categories',
}: {
  category: Category
  subCount?: number
  productCount?: number
  onClose: () => void
  backUrl?: string
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      zIndex="z-[300]"
      title={
        <span className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-accent-500/10 flex items-center justify-center shrink-0">
            <CategoryIcon iconName={category.icon_name} categoryName={category.name} className="w-5 h-5 text-accent-500" />
          </span>
          {category.name}
        </span>
      }
      description={<span className="font-mono">{category.slug}</span>}
      footer={
        <>
          <a
            href={`/categories/${category.slug}`}
            target="_blank"
            rel="noreferrer"
            className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary"
          >
            View on Store
          </a>
          <Link
            href={ap(`/admin/categories/${category.id}?back=${encodeURIComponent(backUrl)}`)}
            className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
            onClick={onClose}
          >
            View Category
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <Fields>
          <Field label="Status" value={<StatusBadge status={String(!!category.is_active)} map={ACTIVE_STATUS} />} />
          <Field label="Display Order" value={String(category.display_order)} />
          {subCount !== undefined && <Field label="Subcategories" value={String(subCount)} />}
          {productCount !== undefined && <Field label="Products" value={String(productCount)} />}
          {category.description && <Field span={2} label="Description" value={category.description} />}
        </Fields>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Return &amp; Replacement Policy</h3>
          <Fields>
            <Field
              label="Returns"
              value={
                <span className={badgeCls(category.return_allowed !== false ? 'green' : 'red')}>
                  {category.return_allowed !== false ? `${category.return_window_days ?? 7} days` : 'Not allowed'}
                </span>
              }
            />
            <Field
              label="Replacement"
              value={
                <span className={badgeCls(category.replacement_allowed !== false ? 'green' : 'red')}>
                  {category.replacement_allowed !== false ? `${category.replacement_window_days ?? 7} days` : 'Not allowed'}
                </span>
              }
            />
          </Fields>
        </div>
      </div>
    </Dialog>
  )
}

function PolicyExpandRow({
  category,
  parentCategory,
  colSpan,
  onSaved,
  onClose,
}: {
  category: Category
  parentCategory?: Category | null
  colSpan: number
  onSaved: (updated: Category) => void
  onClose: () => void
}) {
  const isSubcat = !!category.parent_category_id
  const isInherited = isSubcat && category.return_allowed == null

  const effectiveReturnAllowed = category.return_allowed ?? parentCategory?.return_allowed ?? true
  const effectiveReturnDays = category.return_window_days ?? parentCategory?.return_window_days ?? 7
  const effectiveReplaceAllowed = category.replacement_allowed ?? parentCategory?.replacement_allowed ?? true
  const effectiveReplaceDays = category.replacement_window_days ?? parentCategory?.replacement_window_days ?? 7

  const [overriding, setOverriding] = useState(!isInherited)
  const [returnAllowed, setReturnAllowed] = useState(!!effectiveReturnAllowed)
  const [returnDays, setReturnDays] = useState(effectiveReturnDays ?? 7)
  const [replacementAllowed, setReplacementAllowed] = useState(!!effectiveReplaceAllowed)
  const [replacementDays, setReplacementDays] = useState(effectiveReplaceDays ?? 7)
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/categories/${category.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: category.name,
          description: category.description || null,
          parent_id: category.parent_category_id || null,
          display_order: category.display_order,
          sku_prefix: category.sku_prefix || null,
          is_active: category.is_active,
          icon_name: category.icon_name || null,
          return_allowed: overriding ? returnAllowed : null,
          return_window_days: overriding ? returnDays : null,
          replacement_allowed: overriding ? replacementAllowed : null,
          replacement_window_days: overriding ? replacementDays : null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Save failed')
      }
      const updated = await res.json()
      showToast('Policy saved', 'success')
      onSaved(updated)
    } catch (e: any) {
      showToast(e.message || 'Save failed', 'error')
      setSaving(false)
    }
  }

  return (
    <tr className="bg-surface-secondary border-b border-border-default">
      <td colSpan={colSpan} className="px-4 py-3">
        <div className="flex flex-wrap items-start gap-4">
          <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide self-center">
            Return &amp; Replacement Policy
          </p>

          {isSubcat && isInherited && !overriding ? (
            <div className="flex items-center gap-3 flex-1">
              <span className="inline-flex items-center gap-1.5 text-xs bg-surface-elevated border border-border-secondary text-foreground-secondary px-2.5 py-1 rounded-full">
                <svg className="w-3 h-3 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Inherited from {parentCategory?.name ?? 'parent'}
                {' — '}
                {effectiveReturnAllowed ? `Returns ${effectiveReturnDays}d` : 'No returns'}
                {' · '}
                {effectiveReplaceAllowed ? `Replacement ${effectiveReplaceDays}d` : 'No replacement'}
              </span>
              <button
                onClick={() => setOverriding(true)}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium underline underline-offset-2"
              >
                Override
              </button>
            </div>
          ) : (
            <>
              {isSubcat && (
                <button
                  onClick={() => setOverriding(false)}
                  className="text-xs text-foreground-muted hover:text-foreground underline underline-offset-2 self-center"
                >
                  Reset to inherited
                </button>
              )}

              <div className="flex items-center gap-2">
                <Toggle id={`ret_${category.id}`} checked={returnAllowed} onChange={setReturnAllowed} label="Returns" />
                {returnAllowed && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={returnDays}
                      onChange={e => setReturnDays(Math.max(1, parseInt(e.target.value) || 1))}
                      className="field-xs w-16 border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                    />
                    <span className="text-xs text-foreground-muted">days</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Toggle
                  id={`rpl_${category.id}`}
                  checked={replacementAllowed}
                  onChange={setReplacementAllowed}
                  label="Replacement"
                />
                {replacementAllowed && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={replacementDays}
                      onChange={e => setReplacementDays(Math.max(1, parseInt(e.target.value) || 1))}
                      className="field-xs w-16 border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                    />
                    <span className="text-xs text-foreground-muted">days</span>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="control-sm border border-border-secondary text-foreground-secondary hover:bg-surface"
            >
              Cancel
            </button>
            <RequireWrite scope="categories:write">
              <button
                onClick={handleSave}
                disabled={saving}
                className="control-sm bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Policy'}
              </button>
            </RequireWrite>
          </div>
        </div>
      </td>
    </tr>
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
  onView,
  policyOpen,
  onTogglePolicy,
  onToggleStatus,
  backUrl = '/admin/categories',
}: {
  category: Category
  isSubcat: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  subCount?: number
  productCount?: number
  onDeleted?: () => void
  onView?: () => void
  policyOpen?: boolean
  onTogglePolicy?: () => void
  onToggleStatus?: () => void
  backUrl?: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  })

  const router = useRouter()
  const { showToast } = useToast()

  async function deleteCategory() {
    const res = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast((await res.json().catch(() => ({})))?.error || 'Failed to delete category. Please try again.', 'error')
      return
    }
    showToast(`"${category.name}" deleted successfully.`, 'success')
    onDeleted?.()
    router.refresh()
  }

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
          <RequireWrite scope="categories:write">
            <button
              {...attributes}
              {...listeners}
              suppressHydrationWarning
              className="cursor-grab active:cursor-grabbing text-foreground-muted hover:text-foreground p-1 rounded touch-none"
              title="Drag to reorder"
              onClick={e => e.stopPropagation()}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
              </svg>
            </button>
          </RequireWrite>
          {!isSubcat && (
            <button
              onClick={e => {
                e.stopPropagation()
                onToggleCollapse?.()
              }}
              className="text-foreground-muted hover:text-foreground p-0.5 rounded transition-transform"
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <svg
                className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {isSubcat && <span className="text-foreground-muted text-sm mr-1">└</span>}
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${isSubcat ? 'bg-surface-secondary' : 'bg-accent-500/10'}`}
          >
            <CategoryIcon
              iconName={category.icon_name}
              categoryName={category.name}
              className={`w-4 h-4 ${isSubcat ? 'text-foreground-muted' : 'text-accent-500'}`}
            />
          </div>
          <HoverCard
            trigger={
              <div onClick={e => e.stopPropagation()}>
                <Link
                  href={ap(`/admin/categories/${category.id}?back=${encodeURIComponent(backUrl)}`)}
                  className={`text-sm hover:text-accent-500 transition-colors cursor-pointer ${isSubcat ? 'text-foreground' : 'font-semibold text-foreground'}`}
                  onClick={e => e.stopPropagation()}
                >
                  {category.name}
                </Link>
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
                <div
                  className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${isSubcat ? 'bg-surface-secondary' : 'bg-accent-500/10'}`}
                >
                  <CategoryIcon
                    iconName={category.icon_name}
                    categoryName={category.name}
                    className={`w-4 h-4 ${isSubcat ? 'text-foreground-muted' : 'text-accent-500'}`}
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
                <span
                  className={category.return_allowed !== false ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                >
                  {category.return_allowed !== false ? `${category.return_window_days ?? 7}d` : 'No'}
                </span>
                <span className="text-foreground-muted">Replacement</span>
                <span
                  className={
                    category.replacement_allowed !== false ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }
                >
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
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
        <RequireWrite
          scope="categories:write"
          fallback={
            <span
              className={`${badgeCls(category.is_active ? 'green' : 'muted')}`}
            >
              {category.is_active ? 'Active' : 'Inactive'}
            </span>
          }
        >
          <button
            onClick={e => {
              e.stopPropagation()
              onToggleStatus?.()
            }}
            className={`${badgeCls(category.is_active ? 'green' : 'muted')} hover:opacity-75 transition-opacity`}
          >
            {category.is_active ? 'Active' : 'Inactive'}
          </button>
        </RequireWrite>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium" onClick={e => e.stopPropagation()}>
        <RequireWrite scope="categories:write">
          <button
            onClick={onTogglePolicy}
            title="Edit return & replacement policy"
            className={`mr-3 control-sm border ${policyOpen ? 'bg-accent-500/10 border-accent-400 text-accent-500' : 'border-border-secondary text-foreground-muted hover:text-foreground hover:bg-surface-secondary'}`}
          >
            Policy
          </button>
          <DraftEditButton
            entity="categories"
            id={category.id}
            name={category.name}
            hasDraft={false}
            backUrl={backUrl}
            label="Edit"
            className="text-accent-500 hover:text-accent-600 mr-4 text-sm"
          />
        </RequireWrite>
        <RowActions
          className="inline-flex"
          size="sm"
          actions={[
            {
              key: 'delete',
              kind: 'delete',
              label: 'Delete Category',
              scope: 'categories:write',
              onSelect: deleteCategory,
              confirm: {
                title: 'Delete Category',
                message: `Delete "${category.name}"? This action cannot be undone.`,
                confirmLabel: 'Delete',
                variant: 'danger',
              },
            },
          ]}
        />
      </td>
    </tr>
  )
}

export default function CategoriesClient({
  initialCategories,
  productCounts = {},
  initialSearch = '',
  initialType = '',
  backUrl = '/admin/categories',
}: {
  initialCategories: Category[]
  productCounts?: Record<string, number>
  initialSearch?: string
  initialType?: string
  backUrl?: string
}) {
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewCategory, setViewCategory] = useState<Category | null>(null)
  const [policyOpenId, setPolicyOpenId] = useState<string | null>(null)
  const [shown, setShown] = useState(10)
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useActionToast()

  const search = searchParams.get('search') || ''
  const typeFilter = searchParams.get('type') || ''
  const PAGE_SIZE = 10

  useEffect(() => {
    setShown(PAGE_SIZE)
  }, [search, typeFilter])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const getSubcats = useCallback(
    (parentId: string) =>
      categories.filter(c => c.parent_category_id === parentId).sort((a, b) => a.display_order - b.display_order),
    [categories]
  )

  const q = search.toLowerCase()
  const categoriesById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const allMainCategories = categories
    .filter(c => !c.parent_category_id)
    .sort((a, b) => a.display_order - b.display_order)

  const filteredMain = allMainCategories.filter(cat => {
    if (typeFilter === 'sub') return false
    const subcats = getSubcats(cat.id)
    const matchesSelf = !q || cat.name.toLowerCase().includes(q) || cat.slug.toLowerCase().includes(q)
    const matchesChild = q
      ? subcats.some(s => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q))
      : false
    return matchesSelf || matchesChild
  })

  const filteredSubOnly =
    typeFilter === 'sub'
      ? categories
          .filter(c => !!c.parent_category_id)
          .filter(c => !q || c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q))
          .sort((a, b) => a.display_order - b.display_order)
      : []

  // Dnd reorder spans the loaded prefix; load 10 more each time.
  const totalVisible = typeFilter === 'sub' ? filteredSubOnly.length : filteredMain.length
  const pagedMain = typeFilter === 'sub' ? [] : filteredMain.slice(0, shown)
  const pagedSubOnly = typeFilter === 'sub' ? filteredSubOnly.slice(0, shown) : []
  const moreControl = {
    total: totalVisible,
    hasMore: shown < totalVisible,
    loadingMore: false,
    loadMore: () => setShown(n => n + PAGE_SIZE),
  }

  const mainCategories = pagedMain

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const flatOrder =
    typeFilter === 'sub'
      ? pagedSubOnly
      : mainCategories.flatMap(m => [m, ...(collapsed.has(m.id) ? [] : getSubcats(m.id))])

  const saveReorder = async (updated: Category[]) => {
    setSaving(true)
    const res = await fetch('/api/categories/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: updated.map(c => ({
          id: c.id,
          display_order: c.display_order,
          parent_category_id: c.parent_category_id ?? null,
        })),
      }),
    }).catch(() => null)
    setSaving(false)
    if (res && res.ok) toast.success('Order saved')
    else toast.error('Failed to save order')
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
      const reordered = arrayMove(
        mains,
        mains.findIndex(c => c.id === activeId),
        mains.findIndex(c => c.id === overId)
      )
      reordered.forEach((c, i) => {
        updated[updated.findIndex(u => u.id === c.id)] = { ...c, display_order: i + 1 }
      })
      setCategories(updated)
      saveReorder(updated)
      return
    }

    if (!isMainDragged && sameParent) {
      const siblings = updated
        .filter(c => c.parent_category_id === activeCat.parent_category_id)
        .sort((a, b) => a.display_order - b.display_order)
      const reordered = arrayMove(
        siblings,
        siblings.findIndex(c => c.id === activeId),
        siblings.findIndex(c => c.id === overId)
      )
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
    setCategories(prev => prev.map(c => (c.id === updated.id ? { ...c, ...updated } : c)))
    setPolicyOpenId(null)
    router.refresh()
  }

  const handleToggleStatus = async (cat: Category) => {
    const next = !cat.is_active
    setCategories(prev => prev.map(c => (c.id === cat.id ? { ...c, is_active: next } : c)))
    try {
      const res = await fetch(`/api/admin/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cat.name,
          description: cat.description || null,
          parent_id: cat.parent_category_id || null,
          display_order: cat.display_order,
          sku_prefix: cat.sku_prefix || null,
          is_active: next,
          icon_name: cat.icon_name || null,
          return_allowed: cat.return_allowed ?? null,
          return_window_days: cat.return_window_days ?? null,
          replacement_allowed: cat.replacement_allowed ?? null,
          replacement_window_days: cat.replacement_window_days ?? null,
        }),
      })
      if (!res.ok) {
        setCategories(prev => prev.map(c => (c.id === cat.id ? { ...c, is_active: !next } : c)))
        toast.error('Failed to update status')
      }
    } catch {
      setCategories(prev => prev.map(c => (c.id === cat.id ? { ...c, is_active: !next } : c)))
      toast.error('Failed to update status')
    }
  }

  const activeCategory = categories.find(c => c.id === activeId)

  return (
    <div className="relative">
      {saving && (
        <div className="fixed bottom-4 right-4 z-50 control-md bg-surface-elevated border border-border-default text-foreground shadow-lg">
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
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={flatOrder.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="hidden md:block bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            <div className="overflow-x-auto overflow-y-visible">
              <table className="w-full text-sm">
                <thead className="border-b border-border-default bg-surface-secondary/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted">
                      Category
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted">
                      Slug
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted">
                      Order
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-foreground-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default/60">
                  {typeFilter === 'sub' ? (
                    pagedSubOnly.length > 0 ? (
                      pagedSubOnly.map(sub => {
                        const parentCat = categories.find(c => c.id === sub.parent_category_id)
                        return (
                          <>
                            <SortableRow
                              key={sub.id}
                              category={sub}
                              isSubcat={true}
                              productCount={productCounts[sub.id] || 0}
                              onDeleted={() => handleCategoryDeleted(sub.id)}
                              onView={() => setViewCategory(sub)}
                              policyOpen={policyOpenId === sub.id}
                              onTogglePolicy={() => setPolicyOpenId(policyOpenId === sub.id ? null : sub.id)}
                              onToggleStatus={() => handleToggleStatus(categories.find(c => c.id === sub.id) ?? sub)}
                              backUrl={backUrl}
                            />
                            {policyOpenId === sub.id && (
                              <PolicyExpandRow
                                category={categories.find(c => c.id === sub.id) ?? sub}
                                parentCategory={parentCat}
                                colSpan={5}
                                onSaved={handleSaved}
                                onClose={() => setPolicyOpenId(null)}
                              />
                            )}
                          </>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={5}>
                          <EmptyState bare title="No subcategories found." />
                        </td>
                      </tr>
                    )
                  ) : mainCategories.length > 0 ? (
                    mainCategories.map(cat => {
                      const subcats = getSubcats(cat.id)
                      const isCollapsed = collapsed.has(cat.id)
                      const visibleSubcats = q
                        ? subcats.filter(s => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q))
                        : subcats
                      return (
                        <Fragment key={cat.id}>
                          <SortableRow
                            key={cat.id}
                            category={cat}
                            isSubcat={false}
                            collapsed={isCollapsed}
                            onToggleCollapse={() => toggleCollapse(cat.id)}
                            subCount={subcats.length}
                            productCount={subcats.reduce(
                              (sum, s) => sum + (productCounts[s.id] || 0),
                              productCounts[cat.id] || 0
                            )}
                            onDeleted={() => handleCategoryDeleted(cat.id)}
                            onView={() => setViewCategory(cat)}
                            policyOpen={policyOpenId === cat.id}
                            onTogglePolicy={() => setPolicyOpenId(policyOpenId === cat.id ? null : cat.id)}
                            onToggleStatus={() => handleToggleStatus(categories.find(c => c.id === cat.id) ?? cat)}
                            backUrl={backUrl}
                          />
                          {policyOpenId === cat.id && (
                            <PolicyExpandRow
                              category={categories.find(c => c.id === cat.id) ?? cat}
                              colSpan={5}
                              onSaved={handleSaved}
                              onClose={() => setPolicyOpenId(null)}
                            />
                          )}
                          {!isCollapsed &&
                            visibleSubcats.map(sub => (
                              <Fragment key={sub.id}>
                                <SortableRow
                                  key={sub.id}
                                  category={sub}
                                  isSubcat={true}
                                  productCount={productCounts[sub.id] || 0}
                                  onDeleted={() => handleCategoryDeleted(sub.id)}
                                  onView={() => setViewCategory(sub)}
                                  policyOpen={policyOpenId === sub.id}
                                  onTogglePolicy={() => setPolicyOpenId(policyOpenId === sub.id ? null : sub.id)}
                                  onToggleStatus={() =>
                                    handleToggleStatus(categories.find(c => c.id === sub.id) ?? sub)
                                  }
                                  backUrl={backUrl}
                                />
                                {policyOpenId === sub.id && (
                                  <PolicyExpandRow
                                    category={categories.find(c => c.id === sub.id) ?? sub}
                                    parentCategory={cat}
                                    colSpan={5}
                                    onSaved={handleSaved}
                                    onClose={() => setPolicyOpenId(null)}
                                  />
                                )}
                              </Fragment>
                            ))}
                        </Fragment>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState bare title="No categories found." />
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
              {activeCategory.parent_category_id ? '└ ' : ''}
              {activeCategory.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div className="md:hidden">
        {(typeFilter === 'sub' ? pagedSubOnly.length === 0 : mainCategories.length === 0) ? (
          <EmptyState title={typeFilter === 'sub' ? 'No subcategories found.' : 'No categories found.'} />
        ) : (
          <CategoriesMobileList
            typeFilter={typeFilter}
            pagedMain={mainCategories}
            pagedSubOnly={pagedSubOnly}
            getSubcats={getSubcats}
            query={q}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            categoriesById={categoriesById}
            productCounts={productCounts}
            backUrl={backUrl}
            onToggleStatus={handleToggleStatus}
            onDeleted={handleCategoryDeleted}
          />
        )}
      </div>

      <InfiniteFooter shown={Math.min(shown, totalVisible)} control={moreControl} noun="categories" className="mt-4" />
    </div>
  )
}
