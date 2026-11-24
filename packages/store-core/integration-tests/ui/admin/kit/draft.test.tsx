import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DraftNotice } from '@/components/admin/kit/draft'
import { DraftActionNotice } from '@/components/admin/kit/draft-action-notice'

describe('DraftNotice', () => {
  it('renders nothing for a live record', () => {
    const { container } = render(<DraftNotice state="live" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the draft message with Discard only', () => {
    const onDiscard = vi.fn()
    render(<DraftNotice state="draft" onDiscard={onDiscard} onRestore={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Editing a draft. The live record is unchanged until you publish.')
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('offers Restore and Discard when a newer local autosave exists', () => {
    const onRestore = vi.fn()
    render(<DraftNotice state="draft-with-local" onRestore={onRestore} onDiscard={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('A newer local autosave exists for this draft.')
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('has no buttons without handlers and honours copy overrides', () => {
    const { rerender } = render(<DraftNotice state="draft" />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<DraftNotice state="draft-with-local" onRestore={() => {}} onDiscard={() => {}} copy={{ restore: 'Bring back', discard: 'Throw away', draftWithLocal: 'Local copy is newer' }} />)
    expect(screen.getByText('Local copy is newer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bring back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Throw away' })).toBeInTheDocument()
  })
})

describe('DraftActionNotice', () => {
  it('submits FormData with intent=discard for a form action', () => {
    const action = vi.fn().mockResolvedValue(undefined)
    render(<DraftActionNotice action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const fd = action.mock.calls[0][0] as FormData
    expect(fd.get('intent')).toBe('discard')
  })

  it('uses a custom intent and calls a no-arg action bare', () => {
    const form = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(<DraftActionNotice action={form} intent="drop" />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect((form.mock.calls[0][0] as FormData).get('intent')).toBe('drop')
    unmount()
    const bare = vi.fn().mockResolvedValue(undefined)
    render(<DraftActionNotice action={bare} kind="noArg" />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(bare).toHaveBeenCalledWith()
  })

  it('has no Discard button without an action and hides when live', () => {
    const { rerender } = render(<DraftActionNotice />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<DraftActionNotice state="live" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
