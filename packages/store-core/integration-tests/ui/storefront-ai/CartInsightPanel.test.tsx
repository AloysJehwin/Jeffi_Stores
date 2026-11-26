import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

let flags: Record<string, boolean>
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import CartInsightPanel from '@/components/storefront-ai/CartInsightPanel'

const items = [{ name: 'Drill', qty: 2 }]

describe('CartInsightPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    flags = { ondeviceSummaryEnabled: true, aiStorefrontEnabled: true }
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
  })

  it('shows the insight from the store AI route', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: 'A solid pick for DIY jobs.' }) })
    render(<CartInsightPanel items={items} />)
    expect(await screen.findByText('A solid pick for DIY jobs.')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ai-cart-insight')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ cart: items })
  })

  it('reuses the line for the rest of the visit instead of asking again', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: 'Once only.' }) })
    const first = render(<CartInsightPanel items={items} />)
    expect(await screen.findByText('Once only.')).toBeInTheDocument()
    first.unmount()
    render(<CartInsightPanel items={items} />)
    expect(await screen.findByText('Once only.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when the AI is off for the plan (403) or unavailable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
    const forbidden = render(<CartInsightPanel items={items} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(forbidden.container).toBeEmptyDOMElement()
    forbidden.unmount()

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'AI unavailable' }) })
    const down = render(<CartInsightPanel items={[{ name: 'Saw', qty: 1 }]} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(down.container).toBeEmptyDOMElement()
  })

  it('does nothing with the storefront AI flag off or an empty cart', async () => {
    flags.aiStorefrontEnabled = false
    const { container, rerender } = render(<CartInsightPanel items={items} />)
    expect(container).toBeEmptyDOMElement()
    flags.aiStorefrontEnabled = true
    rerender(<CartInsightPanel items={[]} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
