import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import BusinessHomeProvider, { useBusinessHome } from '@/components/visitor/home/business/BusinessHomeProvider'

function Probe() {
  const { status, data, href } = useBusinessHome()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="company">{data?.company.name ?? ''}</span>
      <span data-testid="href">{href('/business/products')}</span>
    </div>
  )
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const json = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('BusinessHomeProvider / useBusinessHome', () => {
  it('shows the visitor view without a provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('status')).toHaveTextContent('visitor')
    expect(screen.getByTestId('href')).toHaveTextContent('/business/products')
  })

  it('stays a visitor and never fetches when not approved or without a query', () => {
    const { rerender } = render(<BusinessHomeProvider approved={false} query="sections=reorder" host="shop.test"><Probe /></BusinessHomeProvider>)
    expect(screen.getByTestId('status')).toHaveTextContent('visitor')
    rerender(<BusinessHomeProvider approved query={null} host="shop.test"><Probe /></BusinessHomeProvider>)
    expect(screen.getByTestId('status')).toHaveTextContent('visitor')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the business data once for an approved session and becomes ready', async () => {
    fetchMock.mockResolvedValue(json(200, { company: { name: 'Acme Ltd', gstNumber: null } }))
    render(<BusinessHomeProvider approved query="sections=quotes" host="shop.test"><Probe /></BusinessHomeProvider>)
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('company')).toHaveTextContent('Acme Ltd')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/business/home?sections=quotes')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { 'X-Auth-Portal': 'business' } })
  })

  it('falls back to the visitor view on 401 or 403', async () => {
    fetchMock.mockResolvedValue(json(401))
    render(<BusinessHomeProvider approved query="q" host="shop.test"><Probe /></BusinessHomeProvider>)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('visitor'))
  })

  it('reports an error for other failures and network errors', async () => {
    fetchMock.mockResolvedValue(json(500))
    const { unmount } = render(<BusinessHomeProvider approved query="q" host="shop.test"><Probe /></BusinessHomeProvider>)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
    unmount()
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<BusinessHomeProvider approved query="q" host="shop.test"><Probe /></BusinessHomeProvider>)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
  })

  it('strips the /business prefix from links on a business host', () => {
    render(<BusinessHomeProvider approved={false} query={null} host="business.jeffi.test"><Probe /></BusinessHomeProvider>)
    expect(screen.getByTestId('href')).toHaveTextContent(/^\/products$/)
  })
})
