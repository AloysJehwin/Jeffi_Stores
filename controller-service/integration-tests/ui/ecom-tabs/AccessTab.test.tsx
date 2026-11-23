import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AccessTab from '@controller/components/admin/ecom/tabs/AccessTab'

// EcomUI Section pulls server-leaning siblings; stub it to a titled wrapper so the tab's own list logic is tested.
vi.mock('@controller/components/admin/ecom/EcomUI', () => ({
  Section: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  ),
}))

type Props = Parameters<typeof AccessTab>[0]
const social = (over: Record<string, unknown> = {}) =>
  ({ id: 's1', provider: 'facebook', page_name: 'Acme Page', page_id: null, ig_user_id: null, status: 'active', token_expiry: null, ...over }) as unknown as Props['social'][number]
const integration = (over: Record<string, unknown> = {}) =>
  ({ id: 'i1', provider: 'razorpay', label: 'Payments', status: 'connected', expires_at: null, ...over }) as unknown as Props['integrations'][number]

describe('AccessTab (empty vs populated)', () => {
  it('shows both empty states when nothing is connected', () => {
    render(<AccessTab social={[]} integrations={[]} />)
    expect(screen.getByText('No Meta account connected.')).toBeInTheDocument()
    expect(screen.getByText('No integrations configured.')).toBeInTheDocument()
  })

  it('renders a social account with provider, handle and status', () => {
    render(<AccessTab social={[social()]} integrations={[]} />)
    expect(screen.getByText('facebook')).toBeInTheDocument()
    expect(screen.getByText('Acme Page')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('falls back through page_id / ig_user_id for the social handle', () => {
    render(<AccessTab social={[social({ page_name: null, page_id: null, ig_user_id: 'ig_99' })]} integrations={[]} />)
    expect(screen.getByText('ig_99')).toBeInTheDocument()
  })

  it('prefers the integration label over the provider name', () => {
    render(<AccessTab social={[]} integrations={[integration()]} />)
    expect(screen.getByText('Payments')).toBeInTheDocument()
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('shows an expiry with days-left styling when a token expires soon', () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString()
    render(<AccessTab social={[social({ token_expiry: soon })]} integrations={[]} />)
    expect(screen.getByText(/d left/)).toBeInTheDocument()
  })
})
