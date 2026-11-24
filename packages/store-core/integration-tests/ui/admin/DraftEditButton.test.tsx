import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const modalProps = vi.fn()
vi.mock('@/components/admin/DraftConfirmModal', () => ({
  default: (p: any) => {
    modalProps(p)
    return (
      <div data-testid="modal">
        <button onClick={p.onClose}>cancel</button>
      </div>
    )
  },
}))

import DraftEditButton from '@/components/admin/DraftEditButton'

describe('DraftEditButton', () => {
  it('labels Edit when there is no draft and opens the modal for the entity', () => {
    render(<DraftEditButton entity="brands" id="b1" name="Acme" hasDraft={false} backUrl="/admin/brands" />)
    expect(screen.queryByTestId('modal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('modal')).toBeInTheDocument()
    expect(modalProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ entity: 'brands', productId: 'b1', productName: 'Acme', existingDraftId: null, backUrl: '/admin/brands' })
    )
  })

  it('labels Edit Draft and passes the existing draft id when a draft exists', () => {
    render(<DraftEditButton entity="brands" id="b1" name="Acme" hasDraft />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft' }))
    expect(modalProps).toHaveBeenLastCalledWith(expect.objectContaining({ existingDraftId: 'b1' }))
  })

  it('uses a custom label and className and closes the modal on cancel', () => {
    render(<DraftEditButton entity="brands" id="b1" name="Acme" hasDraft={false} label="Change" className="mine" />)
    const btn = screen.getByRole('button', { name: 'Change' })
    expect(btn).toHaveClass('mine')
    fireEvent.click(btn)
    fireEvent.click(screen.getByText('cancel'))
    expect(screen.queryByTestId('modal')).toBeNull()
  })
})
