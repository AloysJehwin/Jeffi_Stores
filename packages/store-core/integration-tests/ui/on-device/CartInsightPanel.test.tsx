import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const runtime = {
  canRunOnDeviceSummary: vi.fn(),
  generateCartInsight: vi.fn(),
  disposeSummarizer: vi.fn(),
}
vi.mock('@/lib/on-device/runtime', () => ({
  canRunOnDeviceSummary: (...a: unknown[]) => runtime.canRunOnDeviceSummary(...a),
  generateCartInsight: (...a: unknown[]) => runtime.generateCartInsight(...a),
  disposeSummarizer: () => runtime.disposeSummarizer(),
}))
vi.mock('@/lib/on-device/user-profile', () => ({ readUserProfile: () => ({ purchaseCount: 0 }) }))
let flags: Record<string, boolean>
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import CartInsightPanel from '@/components/on-device/CartInsightPanel'

const items = [{ name: 'Drill', qty: 2 }] as never

describe('CartInsightPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    flags = { ondeviceSummaryEnabled: true, aiStorefrontEnabled: true, ondeviceSummaryDesktopEnabled: true, ondeviceSummaryMobileEnabled: false }
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the on-device insight once generated', async () => {
    runtime.canRunOnDeviceSummary.mockResolvedValue({ capable: true, isMobile: false })
    runtime.generateCartInsight.mockResolvedValue('A solid pick for DIY jobs.')
    render(<CartInsightPanel items={items} />)
    expect(await screen.findByText('A solid pick for DIY jobs.')).toBeInTheDocument()
    expect(screen.getByText('on-device')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the server when the device cannot run the model', async () => {
    runtime.canRunOnDeviceSummary.mockResolvedValue({ capable: false, isMobile: true })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: 'Server insight' }) })
    render(<CartInsightPanel items={items} />)
    expect(await screen.findByText('Server insight')).toBeInTheDocument()
    expect(screen.getByText('ollama')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ cart: items })
  })

  it('renders nothing when the server says AI is off (403)', async () => {
    runtime.canRunOnDeviceSummary.mockResolvedValue({ capable: false, isMobile: false })
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    const { container } = render(<CartInsightPanel items={items} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('does nothing with the storefront AI flag off or an empty cart', async () => {
    flags.aiStorefrontEnabled = false
    const { container, rerender } = render(<CartInsightPanel items={items} />)
    expect(container).toBeEmptyDOMElement()
    flags.aiStorefrontEnabled = true
    rerender(<CartInsightPanel items={[]} />)
    expect(runtime.canRunOnDeviceSummary).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
