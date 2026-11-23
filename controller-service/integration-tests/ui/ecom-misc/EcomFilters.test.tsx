import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import EcomFilters from '@controller/components/admin/ecom/EcomFilters'

// Router + search params mocked so the URL-param bar runs without Next. AdminSelect (a portal
// dropdown) is replaced by a plain native select so these tests stay about EcomFilters' own
// param-writing / debounce logic.
const push = vi.fn<(...a: any[]) => any>()
let search = new URLSearchParams('')

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/ecom/customers',
  useSearchParams: () => search,
}))

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ label, value, options, onChange }: { label?: string; value?: string; options: { value: string; label: string }[]; onChange?: (v: string) => void }) => (
    <select aria-label={label} value={value} onChange={e => onChange?.(e.target.value)}>
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

describe('EcomFilters', () => {
  beforeEach(() => {
    search = new URLSearchParams('')
    push.mockReset()
  })

  it('renders status, plan and search controls by default', () => {
    render(<EcomFilters plans={[{ slug: 'pro', name: 'Pro' }]} />)
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Plan')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search store name/)).toBeInTheDocument()
    // Plan options include the inactive marker handling.
    expect(screen.getByRole('option', { name: 'Pro' })).toBeInTheDocument()
  })

  it('hides the plan dropdown when showPlan is false', () => {
    render(<EcomFilters showPlan={false} />)
    expect(screen.queryByLabelText('Plan')).not.toBeInTheDocument()
  })

  it('labels an inactive plan', () => {
    render(<EcomFilters plans={[{ slug: 'legacy', name: 'Legacy', active: false }]} />)
    expect(screen.getByRole('option', { name: 'Legacy (inactive)' })).toBeInTheDocument()
  })

  it('pushes the status param immediately on change', () => {
    render(<EcomFilters />)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } })
    expect(push).toHaveBeenCalledWith('/admin/ecom/customers?status=active')
  })

  it('debounces the search box and pushes q after the delay', () => {
    vi.useFakeTimers()
    try {
      render(<EcomFilters />)
      fireEvent.change(screen.getByPlaceholderText(/Search store name/), { target: { value: 'acme' } })
      expect(push).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(push).toHaveBeenCalledWith('/admin/ecom/customers?q=acme')
    } finally {
      vi.useRealTimers()
    }
  })
})
