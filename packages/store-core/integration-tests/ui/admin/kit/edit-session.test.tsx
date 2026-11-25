import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/components/admin/AutosaveStatusPill', () => ({ default: ({ status }: any) => <span data-testid="pill">{status}</span> }))

import { EditSessionActions } from '@/components/admin/kit/edit-session'

const base = { autosaveStatus: 'idle' as const, sessionStatus: 'open' as any, onCancel: vi.fn().mockResolvedValue(true) }

describe('EditSessionActions', () => {
  beforeEach(() => {
    base.onCancel = vi.fn().mockResolvedValue(true)
    push.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('hides the autosave pill while idle and shows it otherwise', () => {
    const { rerender } = render(<EditSessionActions {...base} />)
    expect(screen.queryByTestId('pill')).toBeNull()
    rerender(<EditSessionActions {...base} autosaveStatus="saved" />)
    expect(screen.getByTestId('pill')).toHaveTextContent('saved')
  })

  it('needs two clicks to cancel, then navigates to cancelHref', async () => {
    render(<EditSessionActions {...base} cancelHref="/admin/products" />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(base.onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes?' }))
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/admin/products'))
    expect(base.onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not navigate when the cancel is refused, and the prompt expires after 4s', async () => {
    vi.useFakeTimers()
    base.onCancel = vi.fn().mockResolvedValue(false)
    render(<EditSessionActions {...base} cancelHref="/x" cancelLabel="Close" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Discard changes?' })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4100)
    })
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes?' }))
    })
    expect(base.onCancel).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('disables Cancel while the session is closing', () => {
    render(<EditSessionActions {...base} sessionStatus="closing" />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('shows Restore and Discard when a newer local autosave exists', () => {
    const restore = vi.fn()
    const discard = vi.fn()
    render(<EditSessionActions {...base} restore={restore} discard={discard} draft />)
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveAttribute('title', 'A newer local autosave exists for this draft.')
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(restore).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('read-only hides Cancel and Restore, and shows a locked pill with optional Discard', () => {
    const discard = vi.fn()
    const { rerender } = render(<EditSessionActions {...base} readOnly restore={() => {}} />)
    expect(screen.getByTestId('pill')).toHaveTextContent('locked')
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<EditSessionActions {...base} readOnly discard={discard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(discard).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})
