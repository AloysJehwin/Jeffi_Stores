import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/coupons' }))

import AccessDenied from '@/components/admin/AccessDenied'

describe('AccessDenied', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the restricted message with the scope label and a dashboard link', () => {
    render(<AccessDenied scopeKey="coupons:read" scopeLabel="Coupons" />)
    expect(screen.getByRole('heading', { name: 'Access Restricted' })).toBeInTheDocument()
    expect(screen.getByText('Coupons')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/admin/dashboard')
  })

  it('files an access request once with the scope and page path', async () => {
    render(<AccessDenied scopeKey="coupons:read" scopeLabel="Coupons" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/access-request')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ scopeKey: 'coupons:read', scopeLabel: 'Coupons', pagePath: '/admin/coupons' })
  })

  it('swallows a failed access request', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<AccessDenied scopeKey="a" scopeLabel="A" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText('Access Restricted')).toBeInTheDocument()
  })
})
