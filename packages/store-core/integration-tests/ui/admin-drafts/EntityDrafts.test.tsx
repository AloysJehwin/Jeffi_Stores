import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))

import EntityDrafts from '@/components/admin/drafts/EntityDrafts'

const drafts = [
  { id: 'd1', title: null, authorId: 'me', authorName: 'Me', updatedAt: '2026-03-01T10:00:00Z', behind: 0, lock: null },
  { id: 'd2', title: 'Spring copy', authorId: 'u2', authorName: 'Asha', updatedAt: '2026-03-02T10:00:00Z', behind: 3, lock: null },
] as never

describe('EntityDrafts', () => {
  it('shows the empty message with the noun', () => {
    render(<EntityDrafts drafts={[]} start={vi.fn()} back="/x" noun="product" />)
    expect(screen.getByText(/No one is editing this product/)).toBeInTheDocument()
  })

  it('lists drafts with names, behind counts and the new-draft form', () => {
    render(<EntityDrafts drafts={drafts} start={vi.fn()} back="/x" me="me" noun="product" />)
    expect(screen.getByText('Open drafts')).toBeInTheDocument()
    expect(screen.getByText('Your draft')).toBeInTheDocument()
    expect(screen.getByText('Spring copy')).toBeInTheDocument()
    expect(screen.getByText(/live changed 3 times since it started/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New draft' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2)
    expect(screen.getByPlaceholderText('Draft name (optional)')).toBeInTheDocument()
  })
})
