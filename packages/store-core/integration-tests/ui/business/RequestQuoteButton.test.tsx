import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const router = { push }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const auth: { user: any } = { user: null }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/components/visitor/CustomSelect', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/shared/QuantityInput', () => ({
  default: ({ quantity, onChange }: any) => <input aria-label="quote-qty" type="number" value={quantity} onChange={e => onChange(Number(e.target.value), e.target.value)} />,
}))
vi.mock('@/components/ui/CopySku', () => ({ default: ({ sku }: any) => <span>copy:{sku}</span> }))

import RequestQuoteButton from '@/components/business/RequestQuoteButton'

const approved = { isBusiness: true, approvalStatus: 'approved' }
const item = (over: Record<string, any> = {}) => ({
  productId: 'p1',
  description: 'Hex Bolt',
  quantity: 1,
  unit: 'Nos',
  currentPrice: 100,
  sku: 'BOLT-1',
  stockStatus: 'in' as const,
  brandName: 'Acme',
  categoryName: 'Fasteners',
  ...over,
})
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Request Quote' }))
const target = () => screen.getByPlaceholderText(/e\.g\. \d/, { selector: 'input[type="number"]' } as any)

describe('RequestQuoteButton', () => {
  beforeEach(() => {
    push.mockClear()
    auth.user = { ...approved }
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders nothing for guests and business accounts that are not approved', () => {
    auth.user = null
    const a = render(<RequestQuoteButton items={[item()]} />)
    expect(a.container).toBeEmptyDOMElement()
    a.unmount()
    auth.user = { isBusiness: true, approvalStatus: 'pending' }
    const b = render(<RequestQuoteButton items={[item()]} />)
    expect(b.container).toBeEmptyDOMElement()
    b.unmount()
    auth.user = { isBusiness: false }
    const c = render(<RequestQuoteButton items={[item()]} />)
    expect(c.container).toBeEmptyDOMElement()
  })

  it('shows the trigger with a custom label and opens a dialog with the item details', () => {
    render(<RequestQuoteButton items={[item()]} label="Ask for a quote" />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a quote' }))
    expect(screen.getByText('Request a Quote')).toBeInTheDocument()
    expect(screen.getAllByText('Hex Bolt').length).toBeGreaterThan(0)
    expect(screen.getByText('copy:BOLT-1')).toBeInTheDocument()
    expect(screen.getByText(/Acme/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit Quote' })).toBeDisabled()
  })

  it('closes with Cancel', () => {
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Request a Quote')).toBeNull()
  })

  it('shows the discount breakdown for a target price and enables submit', () => {
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(target(), { target: { value: '90' } })
    expect(screen.getByText('10% off')).toBeInTheDocument()
    expect(screen.getByText(/Potential saving of ₹\s*10\.00 per unit if approved/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit Quote' })).toBeEnabled()
  })

  it('derives the target from a percentage discount, and clears the other field', () => {
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(target(), { target: { value: '90' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '20' } })
    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect((target() as HTMLInputElement).value).toBe('')
  })

  it('caps a percentage discount at 30', () => {
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '55' } })
    expect((screen.getByPlaceholderText('e.g. 10') as HTMLInputElement).value).toBe('30')
  })

  it('blocks submitting a target below the 30% limit and says why', () => {
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(target(), { target: { value: '50' } })
    expect(screen.getByText(/Maximum discount is 30% — minimum target price is ₹\s*70\.00/)).toBeInTheDocument()
    expect(screen.getByText(/exceeds the 30% discount limit/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit Quote' })).toBeDisabled()
  })

  it('warns when the target is at or above the current price', () => {
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(target(), { target: { value: '120' } })
    expect(screen.getByText('Target price is at or above current price')).toBeInTheDocument()
  })

  it('submits the request, closes, confirms and goes to the quotes list', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ rfq: { rfq_number: 'RFQ-0042' } })))
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(screen.getByLabelText('quote-qty'), { target: { value: '5' } })
    fireEvent.change(target(), { target: { value: '90' } })
    fireEvent.change(screen.getByPlaceholderText(/Grade 10\.9/), { target: { value: ' stainless ' } })
    fireEvent.change(screen.getByPlaceholderText(/Any other requirements/), { target: { value: 'Need by Friday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quote' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/business/quotes'))
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('RFQ-0042'), 'success')
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, any]
    expect(url).toBe('/api/business/rfqs')
    expect(JSON.parse(init.body)).toEqual({
      notes: 'Need by Friday',
      items: [{ productId: 'p1', variantId: undefined, subVariantId: undefined, description: 'Hex Bolt', quantity: 5, unit: 'Nos', requested_price: 90, notes: 'stainless' }],
    })
    expect(screen.queryByText('Request a Quote')).toBeNull()
  })

  it('shows the server error and keeps the dialog open when submitting fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Too many open requests' }), { status: 429 }))
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(screen.getByPlaceholderText(/Grade 10\.9/), { target: { value: 'note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quote' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too many open requests', 'error'))
    expect(screen.getByText('Request a Quote')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows a generic error when the request throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    render(<RequestQuoteButton items={[item()]} />)
    open()
    fireEvent.change(screen.getByPlaceholderText(/Grade 10\.9/), { target: { value: 'note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quote' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to submit quote request', 'error'))
  })

  it('requires a variant choice for a product with variants and prices from the chosen one', () => {
    const variants = [
      { id: 'v1', variant_name: 'M8', sku: 'B-M8', price: 100, stock_status: 'In Stock' },
      { id: 'v2', variant_name: 'M10', sku: 'B-M10', price: 150, stock_status: 'Out of Stock' },
    ]
    render(<RequestQuoteButton items={[item({ currentPrice: null, sku: null, variants })]} />)
    open()
    fireEvent.change(screen.getByLabelText('Select a variant'), { target: { value: 'v2' } })
    expect(screen.getAllByText('Hex Bolt — M10').length).toBeGreaterThan(0)
    expect(screen.getByText('copy:B-M10')).toBeInTheDocument()
    fireEvent.change(target(), { target: { value: '120' } })
    expect(screen.getByText('20% off')).toBeInTheDocument()
  })

  it('offers sub-variants for the chosen variant and uses their price', () => {
    const variants = [
      {
        id: 'v1',
        variant_name: 'Steel',
        price: 100,
        sub_variants: [
          { id: 's1', sub_variant_name: 'Zinc', sku: 'B-Z', price: 200, is_active: true },
          { id: 's2', sub_variant_name: 'Retired', price: 50, is_active: false },
        ],
      },
    ]
    render(<RequestQuoteButton items={[item({ variants, businessDiscountPct: 10 })]} />)
    open()
    fireEvent.change(screen.getByLabelText('Select a variant'), { target: { value: 'v1' } })
    const sub = screen.getByLabelText('Select an option') as HTMLSelectElement
    expect(Array.from(sub.options).map(o => o.textContent)).toEqual(['Select an option', 'Zinc'])
    fireEvent.change(sub, { target: { value: 's1' } })
    expect(screen.getAllByText('Hex Bolt — Steel — Zinc').length).toBeGreaterThan(0)
    expect(screen.getByText('₹180.00')).toBeInTheDocument()
  })

  it('handles several items: tabs, stepping, and a combined submit label', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ rfq: { rfq_number: 'RFQ-9' } })))
    render(<RequestQuoteButton items={[item(), item({ productId: 'p2', description: 'Washer', currentPrice: 10, sku: 'W-1' })]} />)
    open()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Previous item' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next item →' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next item →' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/Grade 10\.9/), { target: { value: 'washer note' } })
    expect(screen.getByRole('button', { name: 'Submit Quote (2 items)' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quote (2 items)' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body).items).toHaveLength(2)
  })

  it('takes the unit chosen on the product page into the quote', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ rfq: { rfq_number: 'RFQ-1' } })))
    render(<RequestQuoteButton items={[item()]} unitMeta={{ key: 'Box', label: 'Box of 6', min: 2, max: 10, step: 2, factor: 6, dimension: 'count' }} />)
    open()
    fireEvent.change(screen.getByPlaceholderText(/Grade 10\.9/), { target: { value: 'n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quote' }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body).items[0]).toMatchObject({ unit: 'Box', quantity: 2 })
  })
})
