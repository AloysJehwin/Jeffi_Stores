import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EcomDialogShell from '@/components/admin/messaging-templates/EcomDialogShell'

// Ecom-themed modal shell (portal to body). Renders nothing when closed; backdrop click + Esc + the X
// all call onClose; title/description/footer/children slot in.

describe('EcomDialogShell (render + interaction)', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <EcomDialogShell open={false} onClose={() => {}} title="Hidden">body</EcomDialogShell>
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('renders title, description, children and footer when open', () => {
    render(
      <EcomDialogShell open onClose={() => {}} title="Reset" description="Review first" footer={<button>Go</button>}>
        <p>Dialog body</p>
      </EcomDialogShell>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Reset')).toBeInTheDocument()
    expect(screen.getByText('Review first')).toBeInTheDocument()
    expect(screen.getByText('Dialog body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
  })

  it('fires onClose from the X button', () => {
    const onClose = vi.fn<() => void>()
    render(<EcomDialogShell open onClose={onClose} title="T">body</EcomDialogShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose on backdrop click but not on panel click', () => {
    const onClose = vi.fn<() => void>()
    render(<EcomDialogShell open onClose={onClose} title="T">body</EcomDialogShell>)
    // Panel click is stopped.
    fireEvent.click(screen.getByText('T'))
    expect(onClose).not.toHaveBeenCalled()
    // The backdrop is the dimming overlay sibling.
    const backdrop = document.querySelector('.bg-black\\/40') as HTMLElement
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose on Escape', () => {
    const onClose = vi.fn<() => void>()
    render(<EcomDialogShell open onClose={onClose} title="T">body</EcomDialogShell>)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
