import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const refresh = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), useSearchParams: () => sp }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/DraftEditButton', () => ({ default: ({ name }: any) => <button>edit:{name}</button> }))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => <div>{actions.map((a: any) => <button key={a.key} onClick={() => a.onSelect()}>{a.label}</button>)}</div>,
}))
vi.mock('@/components/visitor/CategoryIcon', () => ({ default: () => <i /> }))
vi.mock('@/components/ui/HoverCard', () => ({ default: ({ trigger }: any) => <div>{trigger}</div> }))
vi.mock('@/components/ui/Toggle', () => ({
  default: ({ id, checked, onChange, label }: any) => <input type="checkbox" aria-label={label} id={id} checked={checked} onChange={e => onChange(e.target.checked)} />,
}))
vi.mock('@admin/app/(admin)/admin/categories/_components/CategoriesMobileList', () => ({ default: () => <div>mobile-list</div> }))
let dragEnd: ((e: any) => void) | null = null
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: any) => { dragEnd = onDragEnd; return <div>{children}</div> },
  DragOverlay: ({ children }: any) => <div>{children}</div>,
  closestCenter: () => null,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  verticalListSortingStrategy: () => null,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false }),
  arrayMove: (arr: any[], from: number, to: number) => { const a = [...arr]; a.splice(to, 0, a.splice(from, 1)[0]); return a },
}))

import CategoriesClient from '@admin/app/(admin)/admin/categories/CategoriesClient'

const cat = (over: Record<string, unknown> = {}): any => ({
  id: 'c1', name: 'Power Tools', slug: 'power-tools', description: 'Drills and saws', icon_name: null, display_order: 1,
  is_active: true, parent_category_id: null, ...over,
})
const cats = [
  cat(),
  cat({ id: 'c2', name: 'Hand Tools', slug: 'hand-tools', display_order: 2, is_active: false }),
  cat({ id: 's1', name: 'Drills', slug: 'drills', parent_category_id: 'c1', display_order: 1 }),
  cat({ id: 's2', name: 'Saws', slug: 'saws', parent_category_id: 'c1', display_order: 2, return_allowed: false }),
]
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const draw = (props: Record<string, unknown> = {}, scopes: string[] = ['categories:write']) =>
  render(asMember(<CategoriesClient initialCategories={cats} productCounts={{ c1: 5, s1: 3 }} {...props} />, scopes))

describe('CategoriesClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    dragEnd = null
    refresh.mockReset()
    showToast.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => json(true, {}))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  })

  it('renders parents with their subcategories, status and order', () => {
    draw()
    expect(screen.getByRole('link', { name: 'Power Tools' })).toHaveAttribute('href', expect.stringContaining('/admin/categories/c1'))
    expect(screen.getByRole('link', { name: 'Drills' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Hand Tools' })).toBeInTheDocument()
    expect(screen.getByText('power-tools')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Active' }).length).toBe(3)
    expect(screen.getByRole('button', { name: 'Inactive' })).toBeInTheDocument()
  })

  it('collapses a parent to hide its subcategories', () => {
    draw()
    fireEvent.click(screen.getAllByTitle('Collapse')[0])
    expect(screen.queryByRole('link', { name: 'Drills' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Expand'))
    expect(screen.getByRole('link', { name: 'Drills' })).toBeInTheDocument()
  })

  it('filters by search text, keeping a parent whose child matches', () => {
    sp = new URLSearchParams('search=saws')
    draw()
    expect(screen.getByRole('link', { name: 'Power Tools' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Saws' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Drills' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Hand Tools' })).not.toBeInTheDocument()
  })

  it('shows only subcategories for the sub level filter, and an empty state when nothing matches', () => {
    sp = new URLSearchParams('level=sub')
    const { unmount } = draw()
    expect(screen.getByRole('link', { name: 'Drills' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Power Tools' })).not.toBeInTheDocument()
    unmount()
    sp = new URLSearchParams('search=zzz')
    draw()
    expect(screen.getAllByText('No categories found.').length).toBeGreaterThan(0)
  })

  it('opens the view dialog with counts and the return policy when a row is clicked', async () => {
    draw()
    fireEvent.click(screen.getByText('power-tools'))
    expect(await screen.findByText('View on Store')).toHaveAttribute('href', '/categories/power-tools')
    expect(screen.getByRole('link', { name: 'View Category' })).toHaveAttribute('href', expect.stringContaining('/admin/categories/c1'))
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.getAllByText('7 days').length).toBe(2)
  })

  it('toggles the status optimistically and PATCHes the new value', async () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Inactive' })).not.toBeInTheDocument())
    const patch = fetchMock.mock.calls.find(c => c[0] === '/api/admin/categories/c2')!
    expect(patch[1].method).toBe('PATCH')
    expect(JSON.parse(patch[1].body)).toMatchObject({ name: 'Hand Tools', is_active: true, parent_id: null })
  })

  it('reverts the status and toasts when the update fails', async () => {
    fetchMock.mockImplementation(async () => json(false))
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update status', 'error'))
    expect(screen.getByRole('button', { name: 'Inactive' })).toBeInTheDocument()
  })

  it('shows read-only status badges and no write controls without write access', () => {
    draw({}, ['categories:read'])
    expect(screen.queryByRole('button', { name: 'Inactive' })).not.toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.queryByTitle('Drag to reorder')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Policy' })).not.toBeInTheDocument()
  })

  it('deletes a category, removes it with its children and refreshes', async () => {
    draw()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Category' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('"Power Tools" deleted successfully.', 'success'))
    expect(fetchMock).toHaveBeenCalledWith('/api/categories/c1', { method: 'DELETE' })
    expect(screen.queryByRole('link', { name: 'Drills' })).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('toasts the server error when a delete fails', async () => {
    fetchMock.mockImplementation(async () => json(false, { error: 'Has products' }))
    draw()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Category' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Has products', 'error'))
    expect(screen.getByRole('link', { name: 'Power Tools' })).toBeInTheDocument()
  })

  it('saves a return policy override and closes the editor', async () => {
    fetchMock.mockImplementation(async () => json(true, { id: 'c1', return_allowed: true, return_window_days: 14 }))
    draw()
    fireEvent.click(screen.getAllByRole('button', { name: 'Policy' })[0])
    const days = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(days, { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Policy' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Policy saved', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[0] === '/api/admin/categories/c1')!
    expect(JSON.parse(patch[1].body)).toMatchObject({ return_allowed: true, return_window_days: 14, replacement_allowed: true, replacement_window_days: 7 })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save Policy' })).not.toBeInTheDocument())
  })

  it('a subcategory shows the inherited policy, can override it and reset to inherited', async () => {
    draw()
    fireEvent.click(screen.getAllByRole('button', { name: 'Policy' })[1])
    expect(screen.getByText(/Inherited from Power Tools/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Override' }))
    expect(screen.getByRole('button', { name: 'Reset to inherited' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to inherited' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Policy' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/categories/s1')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[0] === '/api/admin/categories/s1')![1].body)).toMatchObject({ parent_id: 'c1', return_allowed: null, return_window_days: null })
  })

  it('toasts a policy save error', async () => {
    fetchMock.mockImplementation(async () => json(false, { error: 'Invalid window' }))
    draw()
    fireEvent.click(screen.getAllByRole('button', { name: 'Policy' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save Policy' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invalid window', 'error'))
  })

  it('persists a drag reorder of parent categories with renumbered display orders', async () => {
    draw()
    dragEnd!({ active: { id: 'c1' }, over: { id: 'c2' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/categories/reorder', expect.objectContaining({ method: 'PATCH' })))
    const body = JSON.parse(fetchMock.mock.calls.find(c => c[0] === '/api/categories/reorder')![1].body)
    expect(body.updates.find((u: any) => u.id === 'c1').display_order).toBe(2)
    expect(body.updates.find((u: any) => u.id === 'c2').display_order).toBe(1)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Order saved', 'success'))
  })

  it('refuses to reorder while filtered', () => {
    draw({ filtered: true })
    dragEnd!({ active: { id: 'c1' }, over: { id: 'c2' } })
    expect(showToast).toHaveBeenCalledWith('Clear the filters to reorder categories', 'error')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('toasts when saving the reorder fails', async () => {
    fetchMock.mockImplementation(async () => json(false))
    draw()
    dragEnd!({ active: { id: 's1' }, over: { id: 's2' } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save order', 'error'))
  })

  it('loads ten more categories at a time', () => {
    const many = Array.from({ length: 12 }, (_, i) => cat({ id: `m${i}`, name: `Cat ${i}`, slug: `cat-${i}`, display_order: i + 1 }))
    render(asAdmin(<CategoriesClient initialCategories={many} />))
    expect(screen.queryByRole('link', { name: 'Cat 11' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cat 9' })).toBeInTheDocument()
  })
})
