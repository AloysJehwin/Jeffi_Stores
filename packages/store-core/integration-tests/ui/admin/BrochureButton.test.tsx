import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/admin/BrochureModal', () => ({
  default: ({ open, mode, onClose }: any) =>
    open ? (
      <div data-testid="modal">
        {mode}
        <button onClick={onClose}>close</button>
      </div>
    ) : null,
}))

import BrochureButton from '@/components/admin/BrochureButton'

describe('BrochureButton', () => {
  it('opens the modal in the given mode and closes it again', () => {
    render(<BrochureButton mode="brand" />)
    expect(screen.queryByTestId('modal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Brochure' }))
    expect(screen.getByTestId('modal')).toHaveTextContent('brand')
    fireEvent.click(screen.getByText('close'))
    expect(screen.queryByTestId('modal')).toBeNull()
  })
})
