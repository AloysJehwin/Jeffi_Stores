import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CollapsibleSection from '@/components/admin/CollapsibleSection'

describe('CollapsibleSection', () => {
  it('starts collapsed and expands/collapses on click', () => {
    render(
      <CollapsibleSection title="History">
        <p>Body text</p>
      </CollapsibleSection>
    )
    const btn = screen.getByRole('button', { name: /History/ })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Body text')).toBeNull()
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Body text')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.queryByText('Body text')).toBeNull()
  })

  it('honours defaultOpen', () => {
    render(
      <CollapsibleSection title="T" defaultOpen>
        <p>Open body</p>
      </CollapsibleSection>
    )
    expect(screen.getByText('Open body')).toBeInTheDocument()
  })

  it('shows the count badge only when positive', () => {
    const { rerender } = render(
      <CollapsibleSection title="T" count={4}>
        x
      </CollapsibleSection>
    )
    expect(screen.getByText('4')).toBeInTheDocument()
    rerender(
      <CollapsibleSection title="T" count={0}>
        x
      </CollapsibleSection>
    )
    expect(screen.queryByText('0')).toBeNull()
  })

  it('accepts a custom className', () => {
    const { container } = render(
      <CollapsibleSection title="T" className="my-card">
        x
      </CollapsibleSection>
    )
    expect(container.firstChild).toHaveClass('my-card')
  })
})
