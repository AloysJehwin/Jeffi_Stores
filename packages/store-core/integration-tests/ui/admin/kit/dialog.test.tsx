import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import { Dialog, ConfirmDialog, Sheet } from '@/components/admin/kit/dialog'

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => {}} title="Hi" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders title, description, body and footer labelled by the heading', () => {
    render(
      <Dialog open onClose={() => {}} title="Edit tag" description="Rename it" footer={<button>Save</button>}>
        <p>content</p>
      </Dialog>
    )
    const dlg = screen.getByRole('dialog', { name: 'Edit tag' })
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Rename it')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('closes from the X, Escape and the backdrop', () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="T" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(document.querySelector('.bg-black\\/50') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('stays open on backdrop click and Escape when not dismissible, and hides the X on request', () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="Locked" dismissible={false} hideClose />)
    const dlg = screen.getByRole('dialog', { name: 'Locked' })
    fireEvent.keyDown(dlg, { key: 'Escape' })
    fireEvent.click(dlg.querySelector('.bg-black\\/50') as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('forwards other keys and locks body scroll while open', () => {
    const onKeyDown = vi.fn()
    const { unmount } = render(<Dialog open onClose={() => {}} title="T" onKeyDown={onKeyDown} />)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('moves focus into the panel and wraps Tab at the ends', async () => {
    vi.useFakeTimers()
    render(
      <Dialog open onClose={() => {}} title="T" footer={<button>Last</button>}>
        <input aria-label="field" />
      </Dialog>
    )
    await act(async () => {
      vi.runAllTimers()
    })
    vi.useRealTimers()
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'Last' })
    expect(close).toHaveFocus()
    const panel = screen.getByRole('dialog').querySelector('[tabindex="-1"]') as HTMLElement
    last.focus()
    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })
})

describe('ConfirmDialog', () => {
  it('confirms and cancels through its buttons', () => {
    const onClose = vi.fn()
    render(<ConfirmDialog open message="Proceed?" onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByText('Proceed?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onClose).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenLastCalledWith(false)
  })

  it('uses danger wording and Enter confirms, Esc cancels', () => {
    const onClose = vi.fn()
    render(<ConfirmDialog open variant="danger" message="Remove it" onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Are you sure?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(onClose).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenLastCalledWith(false)
  })

  it('shows a text input for prompts and reports edits', () => {
    const onChange = vi.fn()
    render(<ConfirmDialog open title="Rename" message="New name" confirmLabel="Rename it" cancelLabel="Never mind" input={{ value: 'abc', placeholder: 'name', onChange }} onClose={() => {}} />)
    const input = screen.getByPlaceholderText('name')
    expect(input).toHaveValue('abc')
    fireEvent.change(input, { target: { value: 'abcd' } })
    expect(onChange).toHaveBeenCalledWith('abcd')
    expect(screen.getByRole('button', { name: 'Rename it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Never mind' })).toBeInTheDocument()
  })

  it('defaults a prompt confirm label to OK', () => {
    render(<ConfirmDialog open message="m" input={{ value: '', onChange: () => {} }} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument()
  })
})

describe('Sheet', () => {
  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button onClick={() => setOpen(true)}>reopen</button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Filters" description="Narrow down" footer={<button>Apply</button>}>
          <p>sheet body</p>
        </Sheet>
      </>
    )
  }

  it('shows content and closes via X, then reopens and closes with Escape', () => {
    render(<Harness />)
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
    expect(screen.getByText('Narrow down')).toBeInTheDocument()
    expect(screen.getByText('sheet body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText('reopen'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on backdrop click and renders nothing when closed', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Sheet open onClose={onClose} title="S" />)
    fireEvent.click(document.querySelector('.bg-black\\/50') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<Sheet open={false} onClose={onClose} title="S" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
