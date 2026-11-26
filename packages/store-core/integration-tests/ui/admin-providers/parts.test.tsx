import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Shared Providers pieces: the section Save with its states, and the readiness line.

vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => null, useToast: () => ({ showToast: vi.fn() }) }))

import { Panel, SaveButton, StatusLine } from '@/components/admin/providers/parts'

const idle = { saving: false, saved: false, error: null }

describe('Providers parts', () => {
  it('shows the save states', () => {
    const { rerender } = render(<SaveButton dirty={false} state={idle} onSave={() => {}} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    rerender(<SaveButton dirty state={idle} onSave={() => {}} />)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    rerender(<SaveButton dirty state={{ ...idle, saving: true }} onSave={() => {}} />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    rerender(<SaveButton dirty={false} state={{ ...idle, saved: true }} onSave={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    rerender(<SaveButton dirty state={{ ...idle, error: 'Unknown store' }} onSave={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown store')
  })

  it('renders a panel with a status line', () => {
    render(
      <Panel id="p" title="Secrets" description="Names only">
        <StatusLine ok={false}>EXOTEL_API_TOKEN missing</StatusLine>
      </Panel>
    )
    expect(screen.getByRole('heading', { name: 'Secrets' })).toBeInTheDocument()
    expect(screen.getByText('EXOTEL_API_TOKEN missing')).toHaveAttribute('title', 'EXOTEL_API_TOKEN missing')
  })
})
