import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const router = { push }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const useAuthMock = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const confirmMock = vi.fn<(...a: any[]) => Promise<boolean>>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmMock }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => <div>visitor-header</div> }))
vi.mock('@/components/business/AccountMobileHeader', () => ({ default: () => <div>business-header</div> }))
vi.mock('@/components/visitor/skeletons/account', () => ({ AddressesSkeleton: ({ portal }: any) => <div>skeleton:{portal}</div> }))
vi.mock('@/components/shared/AccountAddressForm', () => ({
  default: ({ formData, setFormData, editing, onSubmit, onCancel, pinLookupState, onPincodeChange }: any) => (
    <form onSubmit={onSubmit} aria-label="address-form">
      <p>{editing ? 'editing' : 'adding'}</p>
      <input aria-label="name" value={formData.full_name} onChange={e => setFormData((p: any) => ({ ...p, full_name: e.target.value }))} />
      <input aria-label="phone" value={formData.phone} onChange={e => setFormData((p: any) => ({ ...p, phone: e.target.value }))} />
      <input aria-label="pin" value={formData.postal_code} onChange={e => onPincodeChange(e.target.value)} />
      <span>pin:{pinLookupState}</span>
      <span>city:{formData.city}</span>
      <button type="submit">submit</button>
      <button type="button" onClick={onCancel}>cancel-form</button>
    </form>
  ),
}))

import { AccountAddressesVisitor, AccountAddressesBusiness } from '@/components/shared/AccountAddresses'

const addr = (over: Record<string, any> = {}) => ({
  id: 'a1',
  address_type: 'shipping',
  full_name: 'Asha Rao',
  address_line1: '12 MG Road',
  address_line2: 'Flat 4',
  landmark: 'Metro',
  city: 'Chennai',
  state: 'TN',
  postal_code: '600001',
  country: 'India',
  phone: '+919876543210',
  is_default: true,
  ...over,
})
const res = (body: any, status = 200) => new Response(JSON.stringify(body), { status })
let current: any[] = []
const loaded = (addresses: any[]) => {
  current = addresses
}
// Saved addresses by default; the "you might also like" strip gets one product.
const route = async (url: any) =>
  String(url).startsWith('/api/products?')
    ? res({ products: [{ id: 'f1', name: 'Featured Speaker', slug: 'speaker', base_price: 500, product_images: [] }] })
    : res({ addresses: current })

describe('AccountAddresses', () => {
  beforeEach(() => {
    push.mockClear()
    useAuthMock.mockReturnValue({ user: { id: 'u1', firstName: 'Asha', lastName: 'Rao', phone: '+919876543210' }, isLoading: false })
    current = []
    vi.stubGlobal('fetch', vi.fn(route))
    confirmMock.mockResolvedValue(true)
  })

  it('shows a skeleton until addresses load', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    render(<AccountAddressesVisitor />)
    expect(screen.getByText('skeleton:store')).toBeInTheDocument()
  })

  it('lists addresses with their details, default badge and the featured products', async () => {
    loaded([addr(), addr({ id: 'a2', address_type: 'billing', full_name: 'Office', is_default: false, landmark: '', address_line2: '' })])
    render(<AccountAddressesVisitor />)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Near: Metro')).toBeInTheDocument()
    expect(screen.getAllByText('Chennai, TN 600001')).toHaveLength(2)
    expect(screen.getByText('Office')).toBeInTheDocument()
    expect(await screen.findByText('Featured Speaker')).toBeInTheDocument()
    expect(screen.getByText('visitor-header')).toBeInTheDocument()
  })

  it('filters by address type, keeping "both" addresses in each', async () => {
    loaded([addr(), addr({ id: 'a2', address_type: 'billing', full_name: 'Office', is_default: false }), addr({ id: 'a3', address_type: 'both', full_name: 'Home', is_default: false })])
    render(<AccountAddressesVisitor />)
    await screen.findByText('Office')
    fireEvent.click(screen.getByRole('button', { name: 'billing' }))
    expect(screen.queryByText('Asha Rao')).toBeNull()
    expect(screen.getByText('Office')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    loaded([])
    render(<AccountAddressesVisitor />)
    expect(await screen.findByText('No addresses saved')).toBeInTheDocument()
  })

  it('opens a prefilled add form from the user profile, and cancels it', async () => {
    loaded([])
    render(<AccountAddressesVisitor />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add New Address' }))
    expect(screen.getByText('adding')).toBeInTheDocument()
    expect(screen.getByLabelText('name')).toHaveValue('Asha Rao')
    expect(screen.getByLabelText('phone')).toHaveValue('9876543210')
    fireEvent.click(screen.getByRole('button', { name: 'cancel-form' }))
    expect(screen.queryByLabelText('address-form')).toBeNull()
  })

  it('refuses a phone number that is not 10 digits', async () => {
    loaded([])
    render(<AccountAddressesVisitor />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add New Address' }))
    fireEvent.change(screen.getByLabelText('phone'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(showToast).toHaveBeenCalledWith('Enter a valid 10-digit mobile number', 'error')
    expect(vi.mocked(fetch).mock.calls.some(c => (c[1] as any)?.method === 'POST')).toBe(false)
  })

  it('saves a new address with POST, reloads the list and closes the form', async () => {
    loaded([])
    render(<AccountAddressesVisitor />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add New Address' }))
    vi.mocked(fetch).mockResolvedValueOnce(res({})).mockResolvedValueOnce(res({ addresses: [addr()] }))
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByText('Chennai, TN 600001')).toBeInTheDocument()
    const post = vi.mocked(fetch).mock.calls.find(c => (c[1] as any)?.method === 'POST')!
    expect(post[0]).toBe('/api/user/addresses')
    expect(JSON.parse((post[1] as any).body)).toMatchObject({ full_name: 'Asha Rao', phone: '9876543210' })
    expect(screen.queryByLabelText('address-form')).toBeNull()
  })

  it('shows the server error when saving fails', async () => {
    loaded([])
    render(<AccountAddressesVisitor />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add New Address' }))
    vi.mocked(fetch).mockResolvedValueOnce(res({ error: 'PIN not serviceable' }, 400))
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('PIN not serviceable', 'error'))
    expect(screen.getByLabelText('address-form')).toBeInTheDocument()
  })

  it('edits an address with PATCH, stripping the +91 prefix from the phone', async () => {
    loaded([addr()])
    render(<AccountAddressesVisitor />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByText('editing')).toBeInTheDocument()
    expect(screen.getByLabelText('phone')).toHaveValue('9876543210')
    vi.mocked(fetch).mockResolvedValueOnce(res({})).mockResolvedValueOnce(res({ addresses: [addr()] }))
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(c => (c[1] as any)?.method === 'PATCH')).toBe(true))
    expect(vi.mocked(fetch).mock.calls.find(c => (c[1] as any)?.method === 'PATCH')![0]).toBe('/api/user/addresses/a1')
  })

  it('looks the PIN up after typing six digits and fills in the city', async () => {
    loaded([])
    render(<AccountAddressesVisitor />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add New Address' }))
    vi.mocked(fetch).mockResolvedValueOnce(res({ district: 'Chennai', state: 'Tamil Nadu', postOffices: ['T Nagar'] }))
    fireEvent.change(screen.getByLabelText('pin'), { target: { value: '60a0017' } })
    expect(screen.getByText('pin:loading')).toBeInTheDocument()
    expect(await screen.findByText('city:Chennai')).toBeInTheDocument()
    expect(screen.getByText('pin:found')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toBe('/api/pincode/600017')
  })

  it('marks the PIN lookup as failed for an unknown PIN', async () => {
    loaded([])
    render(<AccountAddressesVisitor />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add New Address' }))
    vi.mocked(fetch).mockResolvedValueOnce(res({}, 404))
    fireEvent.change(screen.getByLabelText('pin'), { target: { value: '000000' } })
    expect(await screen.findByText('pin:error')).toBeInTheDocument()
  })

  it('deletes after confirmation, and does nothing when declined', async () => {
    loaded([addr()])
    render(<AccountAddressesVisitor />)
    await screen.findByText('Asha Rao')
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(vi.mocked(fetch).mock.calls.some(c => (c[1] as any)?.method === 'DELETE')).toBe(false)

    vi.mocked(fetch).mockResolvedValueOnce(res({})).mockResolvedValueOnce(res({ addresses: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Address deleted successfully', 'success'))
    expect(await screen.findByText('No addresses saved')).toBeInTheDocument()
  })

  it('sends signed-out visitors and business users to their sign-in pages', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false })
    const a = render(<AccountAddressesVisitor />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?redirect=/account/addresses'))
    a.unmount()
    render(<AccountAddressesBusiness />)
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('signin?redirect=/account/addresses')))
  })

  it('uses the business header and portal headers, with no featured products', async () => {
    loaded([addr()])
    render(<AccountAddressesBusiness />)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('business-header')).toBeInTheDocument()
    expect(screen.queryByText('Featured Speaker')).toBeNull()
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { 'X-Auth-Portal': 'business' } })
  })
})
