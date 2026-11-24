import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Pencil } from 'lucide-react'

// RowActions: icon buttons/links with hidden + scope gating and an optional/auto confirm before onSelect.

let canWrite = true
const confirmFn = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))

import RowActions from '@/components/admin/RowActions'

beforeEach(() => {
  canWrite = true
  confirmFn.mockResolvedValue(true)
})

describe('RowActions', () => {
  it('renders link actions as anchors and button actions as buttons', () => {
    render(
      <RowActions
        actions={[
          { key: 'v', label: 'View', icon: Pencil, href: '/admin/x/1' },
          { key: 'b', label: 'Run', icon: Pencil, onSelect: () => {} },
        ]}
      />
    )
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/admin/x/1')
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  it('runs onSelect directly when there is no confirm', async () => {
    const onSelect = vi.fn<(...a: any[]) => any>()
    render(<RowActions actions={[{ key: 'b', label: 'Run', icon: Pencil, onSelect }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(confirmFn).not.toHaveBeenCalled()
  })

  it('confirms with a string spec and aborts when declined', async () => {
    confirmFn.mockResolvedValue(false)
    const onSelect = vi.fn<(...a: any[]) => any>()
    render(<RowActions actions={[{ key: 'b', label: 'Run', icon: Pencil, onSelect, confirm: 'Sure?' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalledWith({ message: 'Sure?' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('auto-confirms a danger action with a default danger spec', async () => {
    const onSelect = vi.fn<(...a: any[]) => any>()
    render(<RowActions actions={[{ key: 'd', label: 'Remove', icon: Pencil, danger: true, onSelect }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onSelect).toHaveBeenCalled())
    expect(confirmFn).toHaveBeenCalledWith({ title: 'Remove', message: 'Remove?', confirmLabel: 'Remove', variant: 'danger' })
  })

  it('drops hidden actions and scoped actions without write access', () => {
    canWrite = false
    render(
      <RowActions
        actions={[
          { key: 'h', label: 'Hidden', icon: Pencil, onSelect: () => {}, hidden: true },
          { key: 's', label: 'Scoped', icon: Pencil, onSelect: () => {}, scope: 'orders:write' },
          { key: 'o', label: 'Open', icon: Pencil, onSelect: () => {} },
        ]}
      />
    )
    expect(screen.queryByRole('button', { name: 'Hidden' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scoped' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
  })

  it('shows a scoped action when the admin can write', () => {
    render(<RowActions actions={[{ key: 's', label: 'Scoped', icon: Pencil, onSelect: () => {}, scope: 'orders:write' }]} />)
    expect(screen.getByRole('button', { name: 'Scoped' })).toBeInTheDocument()
  })

  it('skips a misconfigured action with no icon/label', () => {
    const { container } = render(<RowActions actions={[{ key: 'x', onSelect: () => {} }]} />)
    expect(container.querySelectorAll('button,a')).toHaveLength(0)
  })

  it('disables a disabled button action', () => {
    render(<RowActions actions={[{ key: 'b', label: 'Run', icon: Pencil, onSelect: () => {}, disabled: true }]} />)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })
})
