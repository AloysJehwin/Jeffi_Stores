import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ConnectPanel from '@/components/admin/marketplace/ConnectPanel'
import type { MarketplaceConnectionStatus } from '@/lib/marketplace/connection-route'
import { res, routeFetch, bodyOf, callsTo } from './marketplace-kit'

// ConnectPanel: credentials, mode, push URL and push token for one marketplace. Secret values never reach the
// browser (only a `set` flag). Test / Save / Rotate / Test order / Disconnect each hit the connection route.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))

const status = (over: Partial<MarketplaceConnectionStatus> = {}): MarketplaceConnectionStatus => ({
  channel: 'myntra',
  connected: false,
  mode: null,
  fields: [
    { key: 'sellerId', label: 'Seller ID', secret: false, set: true, value: 'S-1', placeholder: 'e.g. 1234' },
    { key: 'apiKey', label: 'API key', secret: true, set: true, value: null, placeholder: null },
  ] as any,
  pushUrl: 'https://shop.test/api/webhooks/myntra',
  hasPushToken: false,
  pushTokenRotatedAt: null,
  previousTokenValidUntil: null,
  ipAllowlist: [],
  lastEventAt: null,
  ...over,
})

const connected = (over: Partial<MarketplaceConnectionStatus> = {}) => status({ connected: true, mode: 'sandbox', hasPushToken: true, ...over })

const URL = '/api/admin/myntra/connection'

function setup(s = status(), canWrite = true, extra: Partial<React.ComponentProps<typeof ConnectPanel>> = {}) {
  const onChanged = vi.fn<(...a: any[]) => any>()
  const utils = render(<ConnectPanel status={s} canWrite={canWrite} onChanged={onChanged} {...extra} />)
  return { onChanged, ...utils }
}

describe('ConnectPanel', () => {
  beforeEach(() => {
    showToast.mockClear()
  })

  it('renders credential fields, masking secrets and hinting that a saved one is kept', () => {
    routeFetch([])
    setup()
    expect(screen.getByLabelText('Seller ID')).toHaveValue('S-1')
    const key = screen.getByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveValue('')
    expect(key).toHaveAttribute('placeholder', 'Saved. Leave blank to keep it.')
    expect(screen.getByRole('button', { name: 'Save and connect' })).toBeEnabled()
    expect(screen.queryByText('Order push')).toBeNull()
  })

  it('is read-only without write access: no action buttons, disabled inputs', () => {
    setup(connected(), false)
    expect(screen.getByLabelText('Seller ID')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rotate token' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Send test order/ })).toBeNull()
  })

  it('tests the entered details and toasts the result', async () => {
    const f = routeFetch([['action=test', res({ ok: true })]])
    setup()
    fireEvent.change(screen.getByLabelText('Seller ID'), { target: { value: 'S-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Myntra accepted these details.', 'success'))
    expect(bodyOf(f, 'action=test')).toEqual({ mode: 'mock', fields: { sellerId: 'S-2', apiKey: '' } })
  })

  it('toasts the marketplace message when the details are rejected', async () => {
    routeFetch([['action=test', res({ ok: false, message: 'Bad key' })]])
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Bad key', 'error'))
  })

  it('toasts a request failure', async () => {
    routeFetch([['action=test', res({ error: 'Server down' }, false)]])
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Server down', 'error'))
  })

  it('saves and connects with the chosen mode, clearing the typed secret afterwards', async () => {
    const f = routeFetch([[URL, res({ ok: true })]])
    const { onChanged } = setup()
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sekret' } })
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Live/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Myntra connected.'))
    expect(bodyOf(f, URL)).toEqual({ mode: 'live', fields: { sellerId: 'S-1', apiKey: 'sekret' } })
    expect(screen.getByLabelText('API key')).toHaveValue('')
  })

  it('hands a new push token to the parent when saving returns one', async () => {
    routeFetch([[URL, res({ ok: true, pushToken: 'tok_new' })]])
    const onToken = vi.fn()
    setup(status(), true, { onToken })
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    await waitFor(() => expect(onToken).toHaveBeenCalledWith('tok_new'))
  })

  it('keeps Save disabled for a connected store until something changes', () => {
    routeFetch([])
    setup(connected())
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Seller ID'), { target: { value: 'S-9' } })
    expect(save).toBeEnabled()
  })

  it('shows the push URL, token state and the last event for a connected store', () => {
    setup(connected({ lastEventAt: '2026-01-02T10:00:00.000Z', pushTokenRotatedAt: '2026-01-01T10:00:00.000Z' }))
    expect(screen.getByText('Order push')).toBeInTheDocument()
    expect(screen.getByText('https://shop.test/api/webhooks/myntra')).toBeInTheDocument()
    expect(screen.getByText(/Rotate to see a new one/)).toBeInTheDocument()
    expect(screen.getByText(/Last event: .*2026/)).toBeInTheDocument()
    expect(screen.getByText(/Switch the mode to Live after a successful test/)).toBeInTheDocument()
  })

  it('says the token is not set yet, and offers to generate one', () => {
    setup(connected({ hasPushToken: false }))
    expect(screen.getByText('Not set yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate token' })).toBeInTheDocument()
  })

  it('rotates the token, showing it once with a copy-now warning', async () => {
    const f = routeFetch([['action=rotate-token', res({ pushToken: 'tok_rotated' })]])
    const { onChanged } = setup(connected({ previousTokenValidUntil: '2026-01-03T10:00:00.000Z' }))
    expect(screen.getByText(/previous token keeps working until/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate token' }))
    expect(await screen.findByText('tok_rotated')).toBeInTheDocument()
    expect(screen.getByText(/not shown again/)).toBeInTheDocument()
    expect(callsTo(f, 'rotate-token')[0][1]).toMatchObject({ method: 'POST' })
    expect(onChanged).toHaveBeenCalledWith(expect.stringContaining('New push token generated'))
  })

  it('sends a test order in a non-live mode only', async () => {
    const f = routeFetch([['action=test-order', res({ orderNumber: 'MYN-77' })]])
    const { onChanged, unmount } = setup(connected())
    fireEvent.click(screen.getByRole('button', { name: /Send test order/ }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Test order MYN-77 received.'))
    expect(callsTo(f, 'test-order')).toHaveLength(1)
    unmount()
    setup(connected({ mode: 'live' }))
    expect(screen.queryByRole('button', { name: /Send test order/ })).toBeNull()
    expect(screen.getByText(/new Myntra orders arrive here on their own/)).toBeInTheDocument()
  })

  it('disconnects with a DELETE and reports it', async () => {
    const f = routeFetch([[URL, res({ ok: true })]])
    const { onChanged } = setup(connected())
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Myntra disconnected. Imported orders and listings are kept.'))
    expect(callsTo(f, URL)[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('refreshes status through the icon button', () => {
    const { onChanged } = setup(connected())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(onChanged).toHaveBeenCalledWith()
  })

  it('does not call onChanged when saving fails', async () => {
    routeFetch([[URL, res({ error: 'Nope' }, false)]])
    const { onChanged } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', 'error'))
    expect(onChanged).not.toHaveBeenCalled()
  })
})
