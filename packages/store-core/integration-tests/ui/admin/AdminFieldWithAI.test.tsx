import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let aiAllowed = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireAi: ({ children }: any) => (aiAllowed ? <>{children}</> : null),
}))

import AdminFieldWithAI from '@/components/admin/AdminFieldWithAI'

describe('AdminFieldWithAI', () => {
  beforeEach(() => {
    aiAllowed = true
  })

  it('renders label, required marker, hint, error and the field', () => {
    render(
      <AdminFieldWithAI
        label="Title"
        htmlFor="t"
        required
        hint="Shown in search"
        error="Too long"
        field={<input id="t" className="base" />}
        aiFill={vi.fn()}
        aiFeature="products:write"
      />
    )
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('Shown in search')).toBeInTheDocument()
    expect(screen.getByText('Too long')).toBeInTheDocument()
  })

  it('reserves room for the in-field sparkle on the field', () => {
    render(
      <AdminFieldWithAI label="Title" htmlFor="t" field={<input id="t" className="base" />} aiFill={vi.fn()} aiFeature="products:write" />
    )
    expect(screen.getByLabelText('Title')).toHaveClass('base', 'pr-10')
  })

  it('calls aiFill when the sparkle is clicked', async () => {
    const aiFill = vi.fn().mockResolvedValue(undefined)
    render(<AdminFieldWithAI label="Title" field={<input />} aiFill={aiFill} aiFeature="products:write" />)
    fireEvent.click(screen.getByRole('button', { name: 'AI enrich' }))
    await waitFor(() => expect(aiFill).toHaveBeenCalledTimes(1))
  })

  it('places the sparkle above the label row without padding the field', () => {
    render(
      <AdminFieldWithAI
        label="Title"
        htmlFor="t"
        placement="above-label"
        field={<input id="t" className="base" />}
        aiFill={vi.fn()}
        aiFeature="products:write"
      />
    )
    expect(screen.getByLabelText('Title')).not.toHaveClass('pr-10')
    expect(screen.getByRole('button', { name: 'AI enrich' })).toBeInTheDocument()
  })

  it('applies column span classes', () => {
    const { container } = render(
      <AdminFieldWithAI label="T" span={3} field={<input />} aiFill={vi.fn()} aiFeature="products:write" />
    )
    expect(container.firstChild).toHaveClass('md:col-span-3')
  })

  it('hides the sparkle without the AI scope but keeps the field', () => {
    aiAllowed = false
    render(<AdminFieldWithAI label="Title" htmlFor="t" field={<input id="t" />} aiFill={vi.fn()} aiFeature="products:write" />)
    expect(screen.queryByRole('button', { name: 'AI enrich' })).toBeNull()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
  })
})
