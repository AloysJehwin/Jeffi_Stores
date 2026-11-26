import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const flags: Record<string, boolean> = {}
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import CheckoutRecapSummary from '@/components/storefront-ai/CheckoutRecapSummary'

const items: any[] = [
  { name: 'Halo Headphones', qty: 2, price: 100 },
  { name: 'Cable', qty: 1, price: 10 },
]
const json = (status: number, body: any) => new Response(JSON.stringify(body), { status })

describe('CheckoutRecapSummary', () => {
  beforeEach(() => {
    Object.assign(flags, { aiStorefrontEnabled: true, ondeviceSummaryEnabled: true })
    vi.stubGlobal('fetch', vi.fn())
    sessionStorage.clear()
  })

  it('shows the recap from the store AI route and takes a thumbs-up', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(200, { text: '3 items, ready to ship to Chennai.' }))
    render(<CheckoutRecapSummary items={items} total={210} />)
    expect(await screen.findByText(/ready to ship to Chennai/)).toBeInTheDocument()
    expect(screen.getByText('Your order at a glance')).toBeInTheDocument()
    expect(screen.getByText('AI summary')).toBeInTheDocument()
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ai-recap')
    expect(JSON.parse(init.body as string)).toEqual({ cart: items, total: 210, itemCount: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Liked' }))
    expect(screen.getByText('Thanks for the feedback!')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Liked' })).toBeNull()
  })

  it('acknowledges a thumbs-down', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(200, { text: 'A summary of your order.' }))
    render(<CheckoutRecapSummary items={items} total={210} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disliked' }))
    expect(screen.getByText('Got it, thanks for telling us.')).toBeInTheDocument()
  })

  it('renders nothing when the plan has no AI, the AI is unavailable, or after a 403', async () => {
    flags.aiStorefrontEnabled = false
    const off = render(<CheckoutRecapSummary items={items} total={5} />)
    expect(off.container).toBeEmptyDOMElement()
    off.unmount()

    flags.aiStorefrontEnabled = true
    vi.mocked(fetch).mockResolvedValueOnce(json(503, { error: 'AI unavailable' })).mockResolvedValueOnce(json(403, {}))
    const down = render(<CheckoutRecapSummary items={items} total={5} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(down.container).toBeEmptyDOMElement()
    down.unmount()
    const forbidden = render(<CheckoutRecapSummary items={items} total={6} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(forbidden.container).toBeEmptyDOMElement()
  })

  it('does nothing for an empty cart', () => {
    const { container } = render(<CheckoutRecapSummary items={[]} total={0} />)
    expect(fetch).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
