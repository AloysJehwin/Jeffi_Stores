import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { emptyDoc, type Block, type PageDoc } from '@jeffi/site-blocks'
import { BlockList, blockLabel, useBlockDnd, type RowActions } from '@/components/admin/site-builder/BlockList'
import { siteRegistry } from '@/lib/site/blocks'

// BlockList: the page's blocks as a sortable list. Row buttons move / hide / duplicate / remove; the dnd hook
// turns a drag into onMove (reorder or re-parent into a "between products" slot) or onInsert (from the library).
const block = (id: string, type = 'product_row', props: Record<string, unknown> = {}, extra: Partial<Block> = {}): Block => ({ id, type, v: 1, props, ...extra })
const docOf = (...blocks: Block[]): PageDoc => ({ ...emptyDoc(), blocks: Object.fromEntries(blocks.map(b => [b.id, b])), order: blocks.filter(b => !(b as any)._child).map(b => b.id) })
const label = (type: string) => siteRegistry.get(type)!.label
const lockedType = siteRegistry.all().find(d => d.locked)?.type
const slotType = siteRegistry.all().find(d => d.slots?.includes('between'))?.type

const actions = (): RowActions => ({ select: vi.fn(), move: vi.fn(), toggleHidden: vi.fn(), duplicate: vi.fn(), remove: vi.fn() })

function Harness({ doc, canWrite = true, selected = null, rows }: { doc: PageDoc; canWrite?: boolean; selected?: string | null; rows: RowActions }) {
  const dnd = useBlockDnd(doc, { onMove: vi.fn(), onInsert: vi.fn() })
  return (
    <DndContext sensors={dnd.sensors} collisionDetection={dnd.collision}>
      <BlockList doc={doc} dnd={dnd} selected={selected} canWrite={canWrite} actions={rows} />
    </DndContext>
  )
}

describe('blockLabel', () => {
  it('prefers the block’s own title, then a code section’s label, then the definition label', () => {
    expect(blockLabel(block('a', 'product_row', { title: 'Fresh in' }))).toBe('Fresh in')
    expect(blockLabel(block('a', 'code_section', { label: 'My banner' }))).toBe('My banner')
    expect(blockLabel(block('a', 'product_row'))).toBe(label('product_row'))
  })

  it('falls back to the type for an unknown block', () => {
    expect(blockLabel(block('a', 'mystery'))).toBe('mystery')
  })
})

describe('BlockList', () => {
  it('lists the blocks in order, marking the selected and hidden ones', () => {
    render(<Harness doc={docOf(block('a', 'product_row', { title: 'Fresh in' }), block('b', 'trust_strip', {}, { visibility: { hidden: true } }))} selected="a" rows={actions()} />)
    expect(screen.getByRole('button', { name: 'Fresh in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: label('trust_strip') })).toBeInTheDocument()
    expect(screen.getByLabelText('Hidden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fresh in' }).closest('div')!.className).toContain('border-accent-500')
  })

  it('selects a block when its name is clicked', () => {
    const rows = actions()
    render(<Harness doc={docOf(block('a'))} rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: label('product_row') }))
    expect(rows.select).toHaveBeenCalledWith('a')
  })

  it('moves, hides, duplicates and removes through the row buttons', () => {
    const rows = actions()
    render(<Harness doc={docOf(block('a'), block('b', 'trust_strip'))} rows={rows} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0])
    expect(rows.move).toHaveBeenCalledWith('a', 1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1])
    expect(rows.move).toHaveBeenCalledWith('b', -1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0])
    expect(rows.toggleHidden).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate' })[0])
    expect(rows.duplicate).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    expect(rows.remove).toHaveBeenCalledWith('b')
  })

  it('disables Move up on the first row and Move down on the last', () => {
    render(<Harness doc={docOf(block('a'), block('b', 'trust_strip'))} rows={actions()} />)
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Move down' })[1]).toBeDisabled()
  })

  it('offers Show on a hidden block', () => {
    render(<Harness doc={docOf(block('a', 'product_row', {}, { visibility: { hidden: true } }))} rows={actions()} />)
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument()
  })

  it.skipIf(!lockedType)('marks a core block and offers no duplicate or remove for it', () => {
    render(<Harness doc={docOf(block('a', lockedType!))} rows={actions()} />)
    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('has no drag handle or row actions without write access', () => {
    render(<Harness doc={docOf(block('a'))} canWrite={false} rows={actions()} />)
    expect(screen.queryByRole('button', { name: /Drag to move/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.getByRole('button', { name: label('product_row') })).toBeInTheDocument()
  })

  it('has a drag handle named after the block for a writer', () => {
    render(<Harness doc={docOf(block('a', 'product_row', { title: 'Fresh in' }))} rows={actions()} />)
    expect(screen.getByRole('button', { name: 'Drag to move Fresh in' })).toBeInTheDocument()
  })

  it.skipIf(!slotType)('shows a "between products" slot with its children, or a hint when empty', () => {
    const child = block('c', 'trust_strip')
    const host = block('h', slotType!, {}, { children: { between: ['c'] } })
    const doc: PageDoc = { ...emptyDoc(), blocks: { h: host, c: child }, order: ['h'] }
    const a = render(<Harness doc={doc} rows={actions()} />)
    expect(screen.getByText('Between products')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: label('trust_strip') })).toBeInTheDocument()
    a.unmount()
    const empty: PageDoc = { ...emptyDoc(), blocks: { h: block('h', slotType!) }, order: ['h'] }
    render(<Harness doc={empty} rows={actions()} />)
    expect(screen.getByText(/Drag a section here/)).toBeInTheDocument()
  })
})

describe('useBlockDnd', () => {
  const doc = docOf(block('a'), block('b', 'trust_strip'), block('c', 'recently_viewed'))
  const setup = () => {
    const onMove = vi.fn()
    const onInsert = vi.fn()
    const hook = renderHook(() => useBlockDnd(doc, { onMove, onInsert }))
    return { onMove, onInsert, hook }
  }
  const active = (id: string, item?: unknown) => ({ id, rect: { current: { translated: null } }, data: { current: item ? { item } : undefined } }) as any
  const over = (id: string) => ({ id, rect: { top: 0, height: 10 } }) as any

  it('starts with the page order as the top list', () => {
    const { hook } = setup()
    expect(hook.result.current.lists.top).toEqual(['a', 'b', 'c'])
    expect(hook.result.current.dragging).toBeUndefined()
  })

  it('moves a block dropped on another row to that row’s position', () => {
    const { hook, onMove } = setup()
    act(() => hook.result.current.onDragStart({ active: active('a') } as any))
    expect(hook.result.current.dragging).toEqual({ kind: 'block', id: 'a' })
    act(() => hook.result.current.onDragEnd({ active: active('a'), over: over('c') } as any))
    expect(onMove).toHaveBeenCalledWith('a', 2, undefined)
    expect(hook.result.current.dragging).toBeUndefined()
  })

  it('does nothing when dropped outside the lists or back where it was', () => {
    const { hook, onMove } = setup()
    act(() => hook.result.current.onDragStart({ active: active('a') } as any))
    act(() => hook.result.current.onDragEnd({ active: active('a'), over: null } as any))
    act(() => hook.result.current.onDragStart({ active: active('b') } as any))
    act(() => hook.result.current.onDragEnd({ active: active('b'), over: over('b') } as any))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('inserts a library block where it was dragged over', () => {
    const { hook, onInsert } = setup()
    const item = { kind: 'new' as const, type: 'product_row', label: 'Products' }
    act(() => hook.result.current.onDragStart({ active: active('lib:product_row', item) } as any))
    expect(hook.result.current.label).toBe('Products')
    act(() => hook.result.current.onDragOver({ active: active('lib:product_row', item), over: over('b') } as any))
    expect(hook.result.current.lists.top).toEqual(['a', '__new__', 'b', 'c'])
    act(() => hook.result.current.onDragEnd({ active: active('lib:product_row', item), over: over('b') } as any))
    expect(onInsert).toHaveBeenCalledWith(item, 1, undefined)
  })

  it('forgets the drag when cancelled', () => {
    const { hook } = setup()
    act(() => hook.result.current.onDragStart({ active: active('a') } as any))
    act(() => hook.result.current.onDragCancel())
    expect(hook.result.current.dragging).toBeUndefined()
  })
})
