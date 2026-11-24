import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const flags: Record<string, boolean> = {}
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
const canRun = vi.fn<(...a: any[]) => any>()
const generateAffirmation = vi.fn<(...a: any[]) => any>()
const maybeRunFineTune = vi.fn()
vi.mock('@/lib/on-device/runtime', () => ({
  canRunOnDeviceSummary: () => canRun(),
  generateAffirmation: (...a: any[]) => generateAffirmation(...a),
  maybeRunFineTune: (...a: any[]) => maybeRunFineTune(...a),
}))
const updateUserProfile = vi.fn()
vi.mock('@/lib/on-device/user-profile', () => ({
  readUserProfile: () => ({ purchaseCount: 1 }),
  updateUserProfile: (...a: any[]) => updateUserProfile(...a),
}))

import OrderAffirmation from '@/components/on-device/OrderAffirmation'

const items = [
  { productName: 'Halo Headphones', quantity: 2, unitPrice: 100, buyMode: 'buy' },
  { productName: 'Cable', quantity: 1, unitPrice: 10 },
]
const json = (status: number, body: any) => new Response(JSON.stringify(body), { status })

describe('OrderAffirmation', () => {
  beforeEach(() => {
    Object.assign(flags, {
      aiStorefrontEnabled: true,
      ondeviceSummaryEnabled: true,
      ondeviceFinetuneEnabled: true,
      ondeviceSummaryDesktopEnabled: true,
      ondeviceSummaryMobileEnabled: false,
      ondeviceFinetuneDesktopEnabled: true,
      ondeviceFinetuneMobileEnabled: false,
    })
    canRun.mockResolvedValue({ capable: true, isMobile: false })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('streams the on-device affirmation, records the order signal and offers fine-tune data', async () => {
    generateAffirmation.mockImplementation(async (_n, _t, _p, _m, onPartial) => {
      onPartial('Great picks')
      return 'Great picks, enjoy your headphones!'
    })
    render(<OrderAffirmation items={items} total={210} />)
    expect(await screen.findByText(/Great picks, enjoy your headphones!/)).toBeInTheDocument()
    expect(screen.getByText('on-device')).toBeInTheDocument()
    expect(updateUserProfile).toHaveBeenCalledWith(expect.objectContaining({ total: 210, itemCount: 3, buyMode: 'buy' }))
    expect(generateAffirmation.mock.calls[0][0]).toEqual(['Halo Headphones', 'Cable'])
    expect(maybeRunFineTune).toHaveBeenCalledWith(true, [expect.objectContaining({ completion: 'Great picks, enjoy your headphones!' })])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to the server when the device cannot run the model', async () => {
    canRun.mockResolvedValue({ capable: false, isMobile: true })
    vi.mocked(fetch).mockResolvedValueOnce(json(200, { text: 'Thanks for your order!' }))
    render(<OrderAffirmation items={items} total={210} />)
    expect(await screen.findByText('Thanks for your order!')).toBeInTheDocument()
    expect(screen.getByText('ollama')).toBeInTheDocument()
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body)).toEqual({ itemNames: ['Halo Headphones', 'Cable'] })
    expect(generateAffirmation).not.toHaveBeenCalled()
  })

  it('falls back to the server when on-device generation throws', async () => {
    generateAffirmation.mockRejectedValue(new Error('gpu lost'))
    vi.mocked(fetch).mockResolvedValueOnce(json(200, { text: 'Server words' }))
    render(<OrderAffirmation items={items} total={5} />)
    expect(await screen.findByText('Server words')).toBeInTheDocument()
  })

  it('renders nothing when the server refuses (AI off for the plan) or fails', async () => {
    canRun.mockResolvedValue({ capable: false, isMobile: false })
    vi.mocked(fetch).mockResolvedValueOnce(json(403, {}))
    const { container } = render(<OrderAffirmation items={items} total={5} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on a server error, an empty reply, or with no items', async () => {
    canRun.mockResolvedValue({ capable: false, isMobile: false })
    vi.mocked(fetch).mockResolvedValueOnce(json(500, {})).mockResolvedValueOnce(json(200, {}))
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

  it('does nothing when the feature or the plan flag is off', () => {
    flags.ondeviceSummaryEnabled = false
    const { container } = render(<OrderAffirmation items={items} total={5} />)
    expect(canRun).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
