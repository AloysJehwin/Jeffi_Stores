import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

// A bottom action sheet (portal). Closed => nothing. Open => title + actions + Cancel.
// Selecting an action fires its onSelect AND closes; danger actions get a red class.

const actions: MobileAction[] = [
  { key: 'edit', label: 'Edit', onSelect: () => {} },
  { key: 'del', label: 'Delete', onSelect: () => {}, danger: true },
  { key: 'arch', label: 'Archive', onSelect: () => {}, disabled: true },
]

describe('MobileActionSheet (render + branches + select)', () => {
  it('renders nothing when closed', () => {
    render(<MobileActionSheet open={false} onClose={() => {}} actions={actions} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title, actions and Cancel when open', () => {
    render(<MobileActionSheet open onClose={() => {}} title="Order actions" actions={actions} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Order actions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('fires onSelect and onClose when an action is chosen', () => {
    const onSelect = vi.fn<(...a: any[]) => any>()
    const onClose = vi.fn<(...a: any[]) => any>()
    render(
      <MobileActionSheet
        open
        onClose={onClose}
        actions={[{ key: 'edit', label: 'Edit', onSelect }]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders a danger action with the red text class and disables a disabled one', () => {
    render(<MobileActionSheet open onClose={() => {}} actions={actions} />)
    expect(screen.getByRole('button', { name: 'Delete' }).className).toMatch(/text-red-600/)
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled()
  })

  it('closes on the Cancel button and on Escape', () => {
    const onClose = vi.fn<(...a: any[]) => any>()
    render(<MobileActionSheet open onClose={onClose} actions={actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
