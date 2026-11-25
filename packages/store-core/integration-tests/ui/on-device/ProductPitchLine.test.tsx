import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const runtime = { canRunOnDeviceSummary: vi.fn(), generateProductPitch: vi.fn() }
vi.mock('@/lib/on-device/runtime', () => ({
  canRunOnDeviceSummary: (...a: unknown[]) => runtime.canRunOnDeviceSummary(...a),
  generateProductPitch: (...a: unknown[]) => runtime.generateProductPitch(...a),
}))
vi.mock('@/lib/on-device/user-profile', () => ({ readUserProfile: () => ({ purchaseCount: 0 }) }))
let flags: Record<string, boolean>
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import ProductPitchLine from '@/components/on-device/ProductPitchLine'

describe('ProductPitchLine', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    flags = { ondeviceSummaryEnabled: true, aiStorefrontEnabled: true, ondeviceSummaryDesktopEnabled: true, ondeviceSummaryMobileEnabled: false }
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the on-device pitch', async () => {
    runtime.canRunOnDeviceSummary.mockResolvedValue({ capable: true, isMobile: false })
    runtime.generateProductPitch.mockResolvedValue('Built for tough jobs.')
    render(<ProductPitchLine productName="Drill" brand="Bosch" category="Tools" />)
    expect(await screen.findByText('Built for tough jobs.')).toBeInTheDocument()
    expect(screen.getByText('on-device')).toBeInTheDocument()
    expect(runtime.generateProductPitch.mock.calls[0].slice(0, 3)).toEqual(['Drill', 'Bosch', 'Tools'])
  })

  it('falls back to the server pitch when on-device generation fails', async () => {
    runtime.canRunOnDeviceSummary.mockResolvedValue({ capable: true, isMobile: false })
    runtime.generateProductPitch.mockRejectedValue(new Error('no model'))
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ pitch: 'Server pitch' }) })
    render(<ProductPitchLine productName="Drill" brand={null} category={null} />)
    expect(await screen.findByText('Server pitch')).toBeInTheDocument()
    expect(screen.getByText('ollama')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ productName: 'Drill', brand: null, category: null })
  })

  it('uses the server on mobile when the mobile flag is off', async () => {
    runtime.canRunOnDeviceSummary.mockResolvedValue({ capable: true, isMobile: true })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ pitch: 'Mobile pitch' }) })
    render(<ProductPitchLine productName="Drill" brand={null} category={null} />)
    expect(await screen.findByText('Mobile pitch')).toBeInTheDocument()
    expect(runtime.generateProductPitch).not.toHaveBeenCalled()
  })

  it('renders nothing on 403, server failure or flags off', async () => {
    runtime.canRunOnDeviceSummary.mockResolvedValue({ capable: false, isMobile: false })
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    const { container, unmount } = render(<ProductPitchLine productName="Drill" brand={null} category={null} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    unmount()

    flags.aiStorefrontEnabled = false
    const off = render(<ProductPitchLine productName="Drill" brand={null} category={null} />)
    expect(off.container).toBeEmptyDOMElement()
  })
})
