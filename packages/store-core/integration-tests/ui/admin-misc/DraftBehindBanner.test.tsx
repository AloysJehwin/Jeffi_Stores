import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DraftBehindBanner from '@/components/admin/drafts/DraftBehindBanner'

// "Live changed since you started this draft". Shows nothing with no behind count and no siblings;
// otherwise a behind line and/or a sibling-drafts line.

describe('DraftBehindBanner (render + branches)', () => {
  it('renders nothing when not behind and no siblings', () => {
    const { container } = render(<DraftBehindBanner info={{ behind: 0, last: null }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when info is null and no siblings', () => {
    const { container } = render(<DraftBehindBanner info={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the behind line with the publisher name', () => {
    render(
      <DraftBehindBanner
        info={{ behind: 1, last: { by: 'Asha', at: '2026-01-02T10:00:00Z', draftTitle: null, fields: 2 } }}
      />
    )
    expect(screen.getByText(/Live changed since you started this draft/)).toBeInTheDocument()
    expect(screen.getByText(/Asha published/)).toBeInTheDocument()
  })

  it('pluralises multiple behind changes', () => {
    render(
      <DraftBehindBanner
        info={{ behind: 3, last: { by: 'Asha', at: '2026-01-02T10:00:00Z', draftTitle: 'Winter', fields: 1 } }}
      />
    )
    expect(screen.getByText(/\(3 changes\)/)).toBeInTheDocument()
    expect(screen.getByText(/“Winter”/)).toBeInTheDocument()
  })

  it('shows a singular sibling line with the custom noun', () => {
    render(<DraftBehindBanner info={{ behind: 0, last: null }} siblings={1} noun="product" />)
    expect(screen.getByText(/1 other draft is open on this product/)).toBeInTheDocument()
  })

  it('shows a plural sibling line', () => {
    render(<DraftBehindBanner info={null} siblings={2} noun="order" />)
    expect(screen.getByText(/2 other drafts are open on this order/)).toBeInTheDocument()
  })
})
