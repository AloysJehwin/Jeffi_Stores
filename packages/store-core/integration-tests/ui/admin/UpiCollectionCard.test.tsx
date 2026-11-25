import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
let overview: { data: any; error: any; reload: (...a: any[]) => any } = { data: null, error: null, reload: () => {} }
const showToast = vi.fn<(...a: any[]) => any>()
const confirmFn = vi.fn<(...a: any[]) => any>()
const reload = vi.fn<(...a: any[]) => any>()

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))
vi.mock('@/components/admin/kit', async orig => ({ ...(await orig<any>()), useOverviewData: () => overview }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ label, value, onChange, options }: any) => (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import UpiCollectionCard from '@/components/admin/UpiCollectionCard'

const fetchMock = vi.fn<(...a: any[]) => any>()
const res = (ok: boolean, data: any = {}) => ({ ok, json: async () => data })
const info = (o: Record<string, any> = {}) => ({
  provider: 'upg', killed: false, vpa: 'shop@okbank', vpaEditable: true,
  alerts: { address: 'alerts-x@in.test', connected: true, lastAlertAt: '2026-11-20T10:00:00Z', trustedCount30d: 4, gmailConfirmation: null },
  phonepe: { editable: true, connected: false }, ...o,
})
const set = (data: any, error: any = null) => { overview = { data, error, reload } }
const open = () => fireEvent.click(screen.getByText('UPI collection'))

beforeEach(() => {
  canWrite = true
  set(info())
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined) }, configurable: true })
})

describe('UpiCollectionCard', () => {
  it('renders nothing on error and a placeholder while loading', () => {
    set(null, new Error('x'))
    const { container, rerender } = render(<UpiCollectionCard />)
    expect(container.firstChild).toBeNull()
    set(null)
    rerender(<UpiCollectionCard />)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('summarises a healthy direct-UPI store collapsed', () => {
    render(<UpiCollectionCard />)
    expect(screen.getByText(/Direct to your UPI ID · shop@okbank/)).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.queryByText('In effect')).not.toBeInTheDocument()
  })

  it('opens itself and flags setup when alerts are not connected or nothing is set up', () => {
    set(info({ alerts: { address: 'a@in.test', connected: false } }))
    const { rerender } = render(<UpiCollectionCard />)
    expect(screen.getByText('alerts not connected')).toBeInTheDocument()
    expect(screen.getByText('In effect')).toBeInTheDocument()
    set(info({ provider: 'none', vpa: null, alerts: null }))
    rerender(<UpiCollectionCard />)
    expect(screen.getByText('not set up')).toBeInTheDocument()
    expect(screen.getByText('Not set')).toBeInTheDocument()
  })

  it('shows an off badge and the reason when killed', () => {
    set(info({ killed: true, reason: 'Platform switch is off' }))
    render(<UpiCollectionCard />)
    expect(screen.getByText('off')).toBeInTheDocument()
    open()
    expect(screen.getByText(/UPI is off \(would use: Direct to your UPI ID\)/)).toBeInTheDocument()
    expect(screen.getByText('Platform switch is off')).toBeInTheDocument()
  })

  it('shows the PhonePe summary with env badge and client id', () => {
    set(info({ provider: 'phonepe', phonepe: { editable: true, connected: true, env: 'production', clientId: 'CID1', merchantId: 'M1', clientVersion: '2', webhookUrl: 'https://s.test/hook', webhookAuthSet: false } }))
    render(<UpiCollectionCard />)
    expect(screen.getByText(/PhonePe · CID1/)).toBeInTheDocument()
    expect(screen.getByText('production')).toBeInTheDocument()
    open()
    expect(screen.getByText('https://s.test/hook')).toBeInTheDocument()
    expect(screen.getByText(/not set — add them below/)).toBeInTheDocument()
    expect(screen.getByText('M1')).toBeInTheDocument()
  })

  it('copies the UPI ID', async () => {
    render(<UpiCollectionCard />)
    open()
    fireEvent.click(screen.getByLabelText('Copy UPI ID'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Copied.', 'success'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('shop@okbank')
  })

  it('edits the UPI ID: validates the format, then saves and reloads', async () => {
    fetchMock.mockResolvedValue(res(true))
    render(<UpiCollectionCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: /Change/ }))
    const input = screen.getByLabelText('UPI ID')
    const save = screen.getByRole('button', { name: 'Save' })
    fireEvent.change(input, { target: { value: 'bad id' } })
    expect(input).toHaveValue('badid')
    expect(screen.getByText('Enter a UPI ID like name@bank.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: 'new.shop@hdfc' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/integrations/upi/vpa')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ vpa: 'new.shop@hdfc' })
    expect(showToast).toHaveBeenCalledWith('UPI ID saved.', 'success')
  })

  it('toasts a UPI ID save failure and can cancel editing', async () => {
    fetchMock.mockResolvedValue(res(false, { error: 'Already used' }))
    render(<UpiCollectionCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: /Change/ }))
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'a1@okbank' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already used', 'error'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('UPI ID')).not.toBeInTheDocument()
  })

  it('hides edit controls without financial:write or when the ID is owner-only', () => {
    canWrite = false
    const { rerender } = render(<UpiCollectionCard />)
    open()
    expect(screen.queryByRole('button', { name: /Change/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add credentials' })).not.toBeInTheDocument()
    canWrite = true
    set(info({ vpaEditable: false }))
    rerender(<UpiCollectionCard />)
    expect(screen.getByText('Only the owner can change the UPI ID.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Change/ })).not.toBeInTheDocument()
  })

  it('shows the bank-alert forwarding steps, the forwarding address and a Google confirmation code/link', () => {
    set(info({ alerts: { address: 'alerts-x@in.test', connected: false, lastAlertAt: null, gmailConfirmation: { code: '123456', link: 'https://mail.google.com/confirm?x=1', at: '2026-11-20T10:00:00Z' } } }))
    render(<UpiCollectionCard />)
    expect(screen.getByText('alerts-x@in.test')).toBeInTheDocument()
    expect(screen.getByText(/No alert has arrived yet/)).toBeInTheDocument()
    expect(screen.getByText('123456')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Gmail's confirmation link/ })).toHaveAttribute('href', 'https://mail.google.com/confirm?x=1')
  })

  it('does not link a confirmation URL that is not Google, and refreshes on demand', () => {
    set(info({ alerts: { address: 'a@in.test', connected: false, gmailConfirmation: { code: null, link: 'https://evil.test/x' } } }))
    render(<UpiCollectionCard />)
    expect(screen.queryByRole('link', { name: /confirmation link/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Nothing received yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Refresh'))
    expect(reload).toHaveBeenCalled()
  })

  it('explains when bank alerts are not enabled on the platform', () => {
    set(info({ alerts: { address: null, connected: false } }))
    render(<UpiCollectionCard />)
    expect(screen.getByText(/Automatic confirmation isn't switched on/)).toBeInTheDocument()
  })

  it('saves PhonePe credentials: needs id, secret and version, sends only filled fields', async () => {
    fetchMock.mockResolvedValue(res(true, { message: 'Saved!' }))
    const { container } = render(<UpiCollectionCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add credentials' }))
    const save = screen.getByRole('button', { name: 'Save credentials' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'production' } })
    const inputs = Array.from(container.querySelectorAll('label input')) as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: 'CID' } })
    fireEvent.change(inputs[1], { target: { value: 'SECRET' } })
    fireEvent.change(inputs[2], { target: { value: '1' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/integrations/phonepe')
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ env: 'production', client_id: 'CID', client_secret: 'SECRET', client_version: '1' })
    expect(showToast).toHaveBeenCalledWith('Saved!', 'success')
  })

  it('shows a credentials save error and keeps the form open', async () => {
    fetchMock.mockResolvedValue(res(false, { error: 'PhonePe said no' }))
    const { container } = render(<UpiCollectionCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add credentials' }))
    const inputs = Array.from(container.querySelectorAll('label input')) as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: 'a' } })
    fireEvent.change(inputs[1], { target: { value: 'b' } })
    fireEvent.change(inputs[2], { target: { value: 'c' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('PhonePe said no', 'error'))
    expect(screen.getByRole('button', { name: 'Save credentials' })).toBeInTheDocument()
  })

  it('tests a connected PhonePe account', async () => {
    set(info({ provider: 'phonepe', phonepe: { editable: true, connected: true, env: 'sandbox', clientId: 'C' } }))
    fetchMock.mockResolvedValue(res(true, { ok: true, message: 'PhonePe reachable' }))
    render(<UpiCollectionCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('PhonePe reachable', 'success'))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/integrations/phonepe?action=test')
  })

  it('removes credentials only after confirming', async () => {
    set(info({ provider: 'phonepe', phonepe: { editable: true, connected: true, env: 'sandbox', clientId: 'C' } }))
    confirmFn.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    fetchMock.mockResolvedValue(res(true))
    render(<UpiCollectionCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove PhonePe credentials?' })))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('PhonePe credentials removed.', 'success'))
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    expect(reload).toHaveBeenCalled()
  })
})
