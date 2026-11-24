import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/visitor/AddressFormModal', () => ({
  default: ({ isOpen, onClose, onSaved }: any) =>
    isOpen ? (
      <div>
        <p>add-form</p>
        <button onClick={() => onSaved({ id: 'new', full_name: 'New Person', address_line1: '9 New St', city: 'Pune', state: 'MH', postal_code: '411001', phone: '9000000000', address_type: 'shipping', country: 'India', is_default: false })}>
          save-new
        </button>
        <button onClick={onClose}>close-form</button>
      </div>
    ) : null,
}))

import OrderAddressChange from '@/components/shared/OrderAddressChange'

const addr = (over: Record<string, any> = {}) => ({
  id: 'a1',
  full_name: 'Asha Rao',
  address_line1: '12 MG Road',
  address_line2: null,
  landmark: null,
  city: 'Chennai',
  state: 'TN',
  postal_code: '600001',
  phone: '9876543210',
  address_type: 'shipping',
  country: 'India',
  is_default: true,
  ...over,
})
const jsonRes = (body: any, status = 200) => new Response(JSON.stringify(body), { status })
const baseProps = { orderId: 'o1', canChange: true, request: null, currentAddress: addr(), onChanged: vi.fn() }
const pendingReq = { id: 'r1', status: 'pending' as const, newAddress: addr({ full_name: 'Ravi K', address_line1: '3 Park Ave' }), adminNotes: null, createdAt: '', reviewedAt: null }

describe('OrderAddressChange', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders nothing when the order cannot change and nothing is pending', () => {
    const { container } = render(<OrderAddressChange {...baseProps} canChange={false} />)
    expect(container.querySelector('button')).toBeNull()
    expect(screen.queryByText('Change delivery address')).toBeNull()
  })

  it('loads saved addresses, marks the current one, and submits the chosen one', async () => {
    const onChanged = vi.fn()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes({ addresses: [addr(), addr({ id: 'a2', full_name: 'Office', address_line1: '5 Brigade Rd', is_default: false, address_type: 'billing' })] }))
      .mockResolvedValueOnce(jsonRes({}))
    render(<OrderAddressChange {...baseProps} onChanged={onChanged} portalHeader="business" />)
    fireEvent.click(screen.getByRole('button', { name: 'Change delivery address' }))
    expect(await screen.findByText('Current delivery address')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ headers: { 'X-Auth-Portal': 'business' } })
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toBeDisabled()
    const submit = screen.getByRole('button', { name: 'Request Change' })
    expect(submit).toBeDisabled()
    fireEvent.click(radios[1])
    fireEvent.click(submit)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [url, init] = vi.mocked(fetch).mock.calls[1] as [string, any]
    expect(url).toBe('/api/orders/o1/address-change')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ addressId: 'a2' })
    expect(screen.queryByText('Change Delivery Address')).toBeNull()
  })

  it('shows the server error when the request is refused and keeps the dialog open', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes({ addresses: [addr({ id: 'a2', address_line1: '5 Brigade Rd' })] }))
      .mockResolvedValueOnce(jsonRes({ error: 'Order already shipped' }, 409))
    render(<OrderAddressChange {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change delivery address' }))
    fireEvent.click(await screen.findByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: 'Request Change' }))
    expect(await screen.findByText('Order already shipped')).toBeInTheDocument()
    expect(screen.getByText('Change Delivery Address')).toBeInTheDocument()
  })

  it('reports when saved addresses cannot be loaded, and when there are none', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes({ error: 'Not signed in' }, 401))
    const first = render(<OrderAddressChange {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change delivery address' }))
    expect(await screen.findByText('Not signed in')).toBeInTheDocument()
    first.unmount()

    vi.mocked(fetch).mockResolvedValueOnce(jsonRes({ addresses: [] }))
    render(<OrderAddressChange {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change delivery address' }))
    expect(await screen.findByText('No saved addresses found.')).toBeInTheDocument()
  })

  it('adds a new address through the form and selects it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes({ addresses: [] }))
    render(<OrderAddressChange {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change delivery address' }))
    fireEvent.click(await screen.findByRole('button', { name: '+ Add new address' }))
    expect(screen.getByText('add-form')).toBeInTheDocument()
    expect(screen.queryByText('Change Delivery Address')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'save-new' }))
    expect(await screen.findByText('New Person')).toBeInTheDocument()
    expect(screen.getByRole('radio')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Request Change' })).toBeEnabled()
  })

  it('closes with Cancel or the close icon', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes({ addresses: [] }))
    render(<OrderAddressChange {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change delivery address' }))
    await screen.findByText('Change Delivery Address')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Change Delivery Address')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change delivery address' }))
    await screen.findByText('Change Delivery Address')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Change Delivery Address')).toBeNull()
  })

  it('shows a pending request with the requested address and lets the buyer withdraw it', async () => {
    const onChanged = vi.fn()
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes({}))
    render(<OrderAddressChange {...baseProps} request={pendingReq} onChanged={onChanged} />)
    expect(screen.getByText('Address change requested')).toBeInTheDocument()
    expect(screen.getByText('Ravi K')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change delivery address' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(fetch).mock.calls[0]).toEqual(['/api/orders/o1/address-change', expect.objectContaining({ method: 'DELETE' })])
  })

  it('shows a withdraw failure inline', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes({ error: 'Already approved' }, 409))
    render(<OrderAddressChange {...baseProps} request={pendingReq} />)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }))
    expect(await screen.findByText('Already approved')).toBeInTheDocument()
  })

  it('shows a pending request read-only when the order can no longer change', () => {
    render(<OrderAddressChange {...baseProps} canChange={false} request={pendingReq} />)
    expect(screen.getByText('Address change requested')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).toBeNull()
  })

  it('says a request was declined, with the store note, and offers a new one', () => {
    render(<OrderAddressChange {...baseProps} request={{ ...pendingReq, status: 'rejected', adminNotes: 'Out of delivery area' }} />)
    expect(screen.getByText(/declined: Out of delivery area/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change delivery address' })).toBeInTheDocument()
  })
})
