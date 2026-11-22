import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Copyable from '@controller/components/admin/ecom/detail/Copyable'

// CopyValue (from the kit) renders a copy button; here we only assert the value text + the dash fallback.

describe('Copyable (render + empty branch)', () => {
  it('renders the value in monospace with a copy control', () => {
    render(<Copyable value="ec2-i-0abc123def456" />)
    expect(screen.getByText('ec2-i-0abc123def456')).toBeInTheDocument()
  })

  it('renders a dash for null/undefined/empty', () => {
    const { rerender } = render(<Copyable value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    rerender(<Copyable value={undefined} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    rerender(<Copyable value="" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
