import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { mockReducedMotion } from '../../../../packages/store-core/integration-tests/ui/admin-dashboard/fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/admin/overview/kit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/admin/overview/kit')>()),
  usePeriod: () => [{ from: '2026-11-01', to: '2026-11-30' }, vi.fn()],
  useOverviewData: () => ({ data: null, error: null, loading: true, reload: vi.fn() }),
}))

import EcomBillingOverview from '@controller/app/(admin)/admin/ecom/billing/_components/EcomBillingOverview'

describe('EcomBillingOverview insights', () => {
  beforeEach(() => {
    mockReducedMotion(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  })

  it('opens the Subscription charges pop-over from the period bar', () => {
    render(<EcomBillingOverview />)
    const button = screen.getByRole('button', { name: 'Insights' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'Subscription charges' })).toBeInTheDocument()
  })
})
