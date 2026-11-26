import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { asAdmin } from '../_support'
import { mockReducedMotion } from '../../../../packages/store-core/integration-tests/ui/admin-dashboard/fixtures'

// One stable instance: ListFilters re-syncs whenever the params object changes, so a fresh one per call loops forever.
const sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => sp,
}))
vi.mock('@/components/admin/overview/kit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/admin/overview/kit')>()),
  usePeriod: () => [{ from: '2026-11-01', to: '2026-11-30' }, vi.fn()],
  useOverviewData: () => ({ data: null, error: null, loading: true, reload: vi.fn() }),
}))

import MessagingOverview from '@admin/app/(admin)/admin/marketing/messaging/_components/MessagingOverview'

describe('MessagingOverview insights', () => {
  beforeEach(() => {
    mockReducedMotion(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  })

  it('opens the Messages sent pop-over from the period bar', () => {
    render(asAdmin(<ConfirmProvider><MessagingOverview /></ConfirmProvider>))
    const button = screen.getByRole('button', { name: 'Insights' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'Messages sent' })).toBeInTheDocument()
  })
})
