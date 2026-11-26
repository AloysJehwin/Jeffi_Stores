import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const flags: Record<string, boolean> = {}
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
const updateUserProfile = vi.fn()
vi.mock('@/lib/storefront-ai/user-profile', () => ({
  updateUserProfile: (...a: any[]) => updateUserProfile(...a),
}))

import OrderAffirmation from '@/components/storefront-ai/OrderAffirmation'

const items = [
  { productName: 'Halo Headphones', quantity: 2, unitPrice: 100, buyMode: 'buy' },
  { productName: 'Cable', quantity: 1, unitPrice: 10 },
]
const json = (status: number, body: any) => new Response(JSON.stringify(body), { status })

describe('OrderAffirmation', () => {
  beforeEach(() => {
    Object.assign(flags, { aiStorefrontEnabled: true, ondeviceSummaryEnabled: true })
    updateUserProfile.mockClear()
    vi.stubGlobal('fetch', vi.fn())
    sessionStorage.clear()
  })

  it('shows the affirmation from the store AI route and records the order signal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(200, { text: 'Great picks, enjoy your headphones!' }))
    render(<OrderAffirmation items={items} total={210} />)
    expect(await screen.findByText('Great picks, enjoy your headphones!')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(updateUserProfile).toHaveBeenCalledWith(expect.objectContaining({ total: 210, itemCount: 3, buyMode: 'buy' }))
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ai-affirmation')
    expect(JSON.parse(init.body as string)).toEqual({ itemNames: ['Halo Headphones', 'Cable'] })
  })

  it('renders nothing when the server refuses (AI off for the plan)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(403, {}))
    const { container } = render(<OrderAffirmation items={items} total={5} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on a server error, an empty reply, or with no items', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, {}))
    const a = render(<OrderAffirmation items={items} total={5} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(a.container).toBeEmptyDOMElement()
    a.unmount()
    const b = render(<OrderAffirmation items={items} total={5} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(b.container).toBeEmptyDOMElement()
    b.unmount()
    const c = render(<OrderAffirmation items={[]} total={0} />)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(c.container).toBeEmptyDOMElement()
  })

  it('does nothing when the feature flag is off', () => {
    flags.ondeviceSummaryEnabled = false
    const { container } = render(<OrderAffirmation items={items} total={5} />)
    expect(fetch).not.toHaveBeenCalled()
    expect(updateUserProfile).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
