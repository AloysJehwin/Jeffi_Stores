import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

let flags: Record<string, boolean>
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import ProductPitchLine from '@/components/storefront-ai/ProductPitchLine'

describe('ProductPitchLine', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    flags = { ondeviceSummaryEnabled: true, aiStorefrontEnabled: true }
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
  })

  it('shows the pitch from the store AI route', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ pitch: 'Built for tough jobs.' }) })
    render(<ProductPitchLine productName="Drill" brand="Bosch" category="Tools" />)
    expect(await screen.findByText('Built for tough jobs.')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ai-pitch')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ productName: 'Drill', brand: 'Bosch', category: 'Tools' })
  })

  it('renders nothing on 403, a failed or empty answer, or with the flags off', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
    const forbidden = render(<ProductPitchLine productName="Drill" brand={null} category={null} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(forbidden.container).toBeEmptyDOMElement()
    forbidden.unmount()

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pitch: '  ' }) })
    const empty = render(<ProductPitchLine productName="Saw" brand={null} category={null} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(empty.container).toBeEmptyDOMElement()
    empty.unmount()

    fetchMock.mockRejectedValueOnce(new Error('network'))
    const failed = render(<ProductPitchLine productName="Hammer" brand={null} category={null} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(failed.container).toBeEmptyDOMElement()
    failed.unmount()

    flags.ondeviceSummaryEnabled = false
    const off = render(<ProductPitchLine productName="Drill" brand={null} category={null} />)
    expect(off.container).toBeEmptyDOMElement()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
