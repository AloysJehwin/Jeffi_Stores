import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const flags: Record<string, boolean> = {}
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
const canRun = vi.fn<(...a: any[]) => any>()
const generateRecap = vi.fn<(...a: any[]) => any>()
const disposeSummarizer = vi.fn()
vi.mock('@/lib/on-device/runtime', () => ({
  canRunOnDeviceSummary: () => canRun(),
  generateRecap: (...a: any[]) => generateRecap(...a),
  disposeSummarizer: () => disposeSummarizer(),
}))
vi.mock('@/lib/on-device/session-signals', () => ({ getViewedProducts: () => [], getSearches: () => [] }))
vi.mock('@/lib/on-device/user-profile', () => ({ readUserProfile: () => ({ purchaseCount: 0 }) }))

import CheckoutRecapSummary from '@/components/on-device/CheckoutRecapSummary'

const items: any[] = [
  { name: 'Halo Headphones', qty: 2, price: 100 },
  { name: 'Cable', qty: 1, price: 10 },
]
const json = (status: number, body: any) => new Response(JSON.stringify(body), { status })

describe('CheckoutRecapSummary', () => {
  beforeEach(() => {
    Object.assign(flags, {
      aiStorefrontEnabled: true,
      ondeviceSummaryEnabled: true,
      ondeviceSummaryDesktopEnabled: true,
      ondeviceSummaryMobileEnabled: false,
    })
    canRun.mockResolvedValue({ capable: true, reason: 'ok', isMobile: false })
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    sessionStorage.clear()
  })

  it('shows the on-device recap and records a thumbs-up', async () => {
    generateRecap.mockImplementation(async (_s, _m, onPartial) => {
      onPartial('3 items')
      return '3 items, ready to ship to Chennai.'
    })
    render(<CheckoutRecapSummary items={items} total={210} />)
    expect(await screen.findByText(/ready to ship to Chennai/)).toBeInTheDocument()
    expect(screen.getByText('Your order at a glance')).toBeInTheDocument()
    expect(screen.getByText('on-device · private')).toBeInTheDocument()
    expect(generateRecap.mock.calls[0][0]).toMatchObject({ total: 210, itemCount: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Liked' }))
    expect(screen.getByText("Thanks! We'll keep this style.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Liked' })).toBeNull()
    expect(JSON.parse(localStorage.getItem('jeffi_od_feedback')!)[0]).toMatchObject({ v: 'liked', style: 'concise' })
  })

  it('records a thumbs-down and acknowledges it', async () => {
    generateRecap.mockResolvedValue('A summary of your order.')
    render(<CheckoutRecapSummary items={items} total={210} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disliked' }))
    expect(screen.getByText("Got it — we'll adjust next time.")).toBeInTheDocument()
  })

  it('uses the server recap when the device is not allowed to run the model', async () => {
    canRun.mockResolvedValue({ capable: true, reason: 'ok', isMobile: true })
    vi.mocked(fetch).mockResolvedValueOnce(json(200, { text: 'Server recap here' }))
    render(<CheckoutRecapSummary items={items} total={210} />)
    expect(await screen.findByText('Server recap here')).toBeInTheDocument()
    expect(screen.getByText('AI summary')).toBeInTheDocument()
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body)).toMatchObject({ total: 210, itemCount: 3 })
  })

  it('falls back to the server when the on-device run fails', async () => {
    generateRecap.mockRejectedValue(new Error('oom'))
    vi.mocked(fetch).mockResolvedValueOnce(json(200, { text: 'Fallback recap' }))
    render(<CheckoutRecapSummary items={items} total={210} />)
    expect(await screen.findByText('Fallback recap')).toBeInTheDocument()
  })

  it('shows a dismissible Wi-Fi hint when the model would run but the connection is not Wi-Fi', async () => {
    canRun.mockResolvedValue({ capable: false, reason: 'not-wifi', isMobile: false })
    vi.mocked(fetch).mockResolvedValue(json(200, { text: 'x' }))
    render(<CheckoutRecapSummary items={items} total={210} />)
    expect(await screen.findByText(/Connect to Wi-Fi/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Connect to Wi-Fi/)).toBeNull()
    expect(sessionStorage.getItem('jeffi_od_wifi_dismissed')).toBe('1')
  })

  it('explains once that the mobile summary stays on the phone', async () => {
    flags.ondeviceSummaryMobileEnabled = true
    canRun.mockResolvedValue({ capable: true, reason: 'ok', isMobile: true })
    generateRecap.mockResolvedValue('Mobile summary')
    render(<CheckoutRecapSummary items={items} total={5} />)
    expect(await screen.findByText(/no data leaves your phone/)).toBeInTheDocument()
    expect(localStorage.getItem('jeffi_od_mobile_shown')).toBe('1')
  })

  it('renders nothing when the store plan has no AI, on a server failure, or after a 403', async () => {
    flags.aiStorefrontEnabled = false
    const off = render(<CheckoutRecapSummary items={items} total={5} />)
    expect(off.container).toBeEmptyDOMElement()
    off.unmount()

    flags.aiStorefrontEnabled = true
    canRun.mockResolvedValue({ capable: false, reason: 'no-webgpu', isMobile: false })
    vi.mocked(fetch).mockResolvedValueOnce(json(500, {})).mockResolvedValueOnce(json(403, {}))
    const err = render(<CheckoutRecapSummary items={items} total={5} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(err.container).toBeEmptyDOMElement()
    err.unmount()
    const forbidden = render(<CheckoutRecapSummary items={items} total={5} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(forbidden.container).toBeEmptyDOMElement()
  })

  it('does nothing for an empty cart', async () => {
    const { container } = render(<CheckoutRecapSummary items={[]} total={0} />)
    await waitFor(() => expect(canRun).toHaveBeenCalled())
    expect(fetch).not.toHaveBeenCalled()
    expect(generateRecap).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
