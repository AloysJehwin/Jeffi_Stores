import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ComplianceDocRow from '@controller/components/admin/ecom/tabs/ComplianceDocRow'

// Router is a side-effect on success; stub it. Write-scope + confirm let ActionButton run.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

const base = {
  tenantId: 't1',
  docId: 'd1',
  name: 'GST certificate',
  pending: true,
  lapsed: false,
  badge: <span>badge</span>,
  detail: <span>detail</span>,
  href: 'https://example.com/doc.pdf',
}

describe('ComplianceDocRow (render + interaction)', () => {
  it('renders the name, detail, view link and a Review action when pending', () => {
    render(<ComplianceDocRow {...base} />)
    expect(screen.getByText('GST certificate')).toBeInTheDocument()
    expect(screen.getByText('detail')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute('href', base.href)
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('labels the toggle Change (not Review) once a document is decided', () => {
    render(<ComplianceDocRow {...base} pending={false} />)
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  it('opens the note input and decision buttons when the toggle is clicked', () => {
    render(<ComplianceDocRow {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByLabelText('Note on the GST certificate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('disables Approve and explains why for a lapsed document', () => {
    render(<ComplianceDocRow {...base} lapsed />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByText(/only the renewed one/i)).toBeInTheDocument()
  })

  it('closes the editor again on Cancel', () => {
    render(<ComplianceDocRow {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Note on the GST certificate')).toBeNull()
  })

  it('renders the review and check slots when provided', () => {
    render(<ComplianceDocRow {...base} review={<span>Approved by Ann</span>} check={<span>auto check</span>} />)
    expect(screen.getByText('Approved by Ann')).toBeInTheDocument()
    expect(screen.getByText('auto check')).toBeInTheDocument()
  })
})
