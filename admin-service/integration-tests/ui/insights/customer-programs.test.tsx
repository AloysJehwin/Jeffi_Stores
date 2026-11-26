import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { asAdmin } from '../_support'

const router = { push: vi.fn(), replace: vi.fn() }
const sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/customer-programs',
  useSearchParams: () => sp,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import ProgramsOverview from '@admin/app/(admin)/admin/customer-programs/_components/ProgramsOverview'

const fetchMock = vi.fn()

describe('ProgramsOverview insights', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('opens the Program activity pop-over from the period bar and loads its series', async () => {
    render(asAdmin(<ToastProvider><ConfirmProvider><ProgramsOverview /></ConfirmProvider></ToastProvider>))
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }))
    expect(screen.getByRole('dialog', { name: 'Program activity' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.map(c => String(c[0]))).toContain('/api/admin/customer-programs/insights?weeks=26&filter=loyalty'))
  })
})
