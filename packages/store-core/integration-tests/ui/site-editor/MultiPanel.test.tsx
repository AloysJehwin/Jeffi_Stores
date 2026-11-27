import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MultiPanel from '@/components/site-editor/MultiPanel'

const handlers = () => ({ onGroup: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(), onCut: vi.fn(), onAlign: vi.fn(), onDistribute: vi.fn() })

describe('MultiPanel', () => {
  it('runs the shared actions on the selection', () => {
    const h = handlers()
    const onPaste = vi.fn()
    render(<MultiPanel count={2} canWrite free={false} {...h} onPaste={onPaste} />)
    expect(screen.getByText('2 elements selected')).toBeInTheDocument()
    for (const [label, fn] of [['Group', h.onGroup], ['Duplicate', h.onDuplicate], ['Copy', h.onCopy], ['Cut', h.onCut], ['Paste', onPaste], ['Delete', h.onDelete]] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(fn).toHaveBeenCalledTimes(1)
    }
    // Not all free layers: no arranging.
    expect(screen.queryByRole('group', { name: 'Align to the selection' })).toBeNull()
  })

  it('aligns free layers to the selection and distributes three or more', () => {
    const h = handlers()
    const { rerender } = render(<MultiPanel count={2} canWrite free {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Align left (to the selection)' }))
    expect(h.onAlign).toHaveBeenCalledWith('left')
    expect(screen.getByRole('button', { name: 'Distribute across' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull()
    rerender(<MultiPanel count={3} canWrite free {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Distribute down' }))
    expect(h.onDistribute).toHaveBeenCalledWith('y')
  })

  it('shows no actions without write access', () => {
    render(<MultiPanel count={2} canWrite={false} free {...handlers()} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
