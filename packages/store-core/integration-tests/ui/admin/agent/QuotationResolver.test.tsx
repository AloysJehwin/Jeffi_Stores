import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/ui/CopySku', () => ({ default: ({ sku }: any) => <button aria-label={`copy ${sku}`} /> }))

import QuotationResolver, { type QuotationResolverBlock } from '@/components/admin/agent/QuotationResolver'

const cand = (id: string, o: any = {}) => ({ productId: id, name: `Product ${id}`, sku: `SKU-${id}`, price: 100, score: 90, ...o })

const matched = (id: string, qty = 5, o: any = {}) => ({ requestedText: `want ${id}`, qty, status: 'matched' as const, candidates: [cand(id)], ...o })

const block = (lines: any[]): QuotationResolverBlock => ({
  type: 'quotation_resolver',
  lines,
  counts: {
    matched: lines.filter(l => l.status === 'matched').length,
    ambiguous: lines.filter(l => l.status === 'ambiguous').length,
    unmatched: lines.filter(l => l.status === 'unmatched').length,
  },
})

const sent = (fn: any) => JSON.parse(fn.mock.calls[0][0].replace('__quotation_confirm__', ''))

afterEach(() => vi.unstubAllGlobals())

describe('QuotationResolver matched lines', () => {
  it('summarises counts and shows the matched product', () => {
    render(<QuotationResolver block={block([matched('1'), matched('2')])} />)
    expect(screen.getByText(/2 matched · 0 need review · 0 not found/)).toBeInTheDocument()
    expect(screen.getByText('Item 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Product 1')).toBeInTheDocument()
    expect(screen.getByText('90')).toHaveClass('text-green-600')
  })

  it('creates the quotation with every matched line', () => {
    const onSend = vi.fn()
    render(<QuotationResolver block={block([matched('1', 5), matched('2', 3)])} onSendMessage={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }))
    expect(onSend.mock.calls[0][0]).toMatch(/^__quotation_confirm__\[/)
    expect(sent(onSend)).toEqual([
      { productId: '1', quantity: 5, requestedText: 'want 1' },
      { productId: '2', quantity: 3, requestedText: 'want 2' },
    ])
  })

  it('navigates between items with the arrows and the dot strip', () => {
    render(<QuotationResolver block={block([matched('1'), matched('2')])} />)
    expect(screen.getByRole('button', { name: 'Previous item' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
    expect(screen.getByText('Item 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('Product 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next item' })).toBeDisabled()
    fireEvent.click(screen.getByTitle('1. want 1'))
    expect(screen.getByText('Item 1 of 2')).toBeInTheDocument()
  })

  it('an invalid quantity blocks creation and points at the item', () => {
    render(<QuotationResolver block={block([matched('1')])} onSendMessage={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0' } })
    expect(screen.getByText('Quantity must be greater than zero.')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Create quotation' })).toBeDisabled()
    expect(screen.getByText(/Check the quantity on/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '' } })
    expect(screen.getByText('Enter a quantity.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '7' } })
    expect(screen.getByRole('button', { name: 'Create quotation' })).toBeEnabled()
  })

  it('rounds a piece request up to the selling unit and says so', () => {
    const units = [{ unit: 'box', label: 'Box', factor: 12, dimension: 'count', minQty: 1, maxQty: null, qtyStep: 1, isDefault: true }]
    const line = { requestedText: 'bolts', qty: 20, status: 'matched' as const, candidates: [cand('1', { units })] }
    render(<QuotationResolver block={block([line])} />)
    expect(screen.getByLabelText('Quantity')).toHaveValue(2)
    expect(screen.getByText(/20 pcs requested → 2 Box = 24 pcs/)).toBeInTheDocument()
    expect(screen.getByText(/Rounded to the selling unit/)).toBeInTheDocument()
  })

  it('switching between count units converts the quantity', () => {
    const units = [
      { unit: 'pc', label: 'Piece', factor: 1, dimension: 'count', minQty: 1, maxQty: null, qtyStep: 1, isDefault: true },
      { unit: 'box', label: 'Box', factor: 12, dimension: 'count', minQty: 1, maxQty: null, qtyStep: 1, isDefault: false },
    ]
    const line = { requestedText: 'bolts', qty: 24, status: 'matched' as const, candidates: [cand('1', { units })] }
    render(<QuotationResolver block={block([line])} />)
    expect(screen.getByLabelText('Quantity')).toHaveValue(24)
    fireEvent.change(screen.getByLabelText('select'), { target: { value: 'box' } })
    expect(screen.getByLabelText('Quantity')).toHaveValue(2)
    expect(screen.getByText('= 24 pcs')).toBeInTheDocument()
  })

  it('variant and sub-variant selectors change the price shown', () => {
    const variants = [
      { id: 'v1', name: 'Small', sku: 'S', price: 50, subVariants: [{ id: 's1', name: 'Red', sku: 'S-R', price: 55 }, { id: 's2', name: 'Blue', sku: 'S-B', price: 58 }] },
      { id: 'v2', name: 'Large', sku: 'L', price: 90 },
    ]
    const line = { requestedText: 'tee', qty: 1, status: 'matched' as const, candidates: [cand('1', { variants })] }
    render(<QuotationResolver block={block([line])} />)
    expect(screen.getByText(/S-R · ₹55\.00/)).toBeInTheDocument()
    const [variantSel, subSel] = screen.getAllByLabelText('select')
    fireEvent.change(subSel, { target: { value: 's2' } })
    expect(screen.getByText(/S-B · ₹58\.00/)).toBeInTheDocument()
    fireEvent.change(variantSel, { target: { value: 'v2' } })
    expect(screen.getByText(/L · ₹90\.00/)).toBeInTheDocument()
    expect(screen.queryByText('Sub-variant')).toBeNull()
  })
})

describe('QuotationResolver ambiguous lines', () => {
  const amb = (qty = 4) => ({ requestedText: 'cable', qty, status: 'ambiguous' as const, candidates: [cand('a', { score: 85 }), cand('b', { score: 55 })] })

  it('hides Create until the line is resolved, and counts review items', () => {
    render(<QuotationResolver block={block([amb(), matched('1')])} />)
    expect(screen.getByText(/1 need review/)).toBeInTheDocument()
    expect(screen.getByText('(0/1 resolved)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create quotation' })).toBeNull()
  })

  it('pages through candidates and uses the chosen one', () => {
    const onSend = vi.fn()
    render(<QuotationResolver block={block([amb(), matched('1')])} onSendMessage={onSend} />)
    expect(screen.getByText('1 / 2 matches')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Prev$/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    expect(screen.getByText('2 / 2 matches')).toBeInTheDocument()
    expect(screen.getByText('Product b')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(screen.getByText('(1/1 resolved)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create quotation' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }))
    expect(sent(onSend)[0]).toMatchObject({ productId: 'b', quantity: 4, requestedText: 'cable' })
  })

  it('shows the locked choice with change to undo it', () => {
    render(<QuotationResolver block={block([amb()])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(screen.getByText('4 pcs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'change' }))
    expect(screen.getByRole('button', { name: 'Use this' })).toBeInTheDocument()
  })

  it('skipping marks it skipped, lets Create through, and Undo restores it', () => {
    const onSend = vi.fn()
    render(<QuotationResolver block={block([amb(), matched('1')])} onSendMessage={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('button', { name: 'Create quotation' })).toBeEnabled()
    fireEvent.click(screen.getByTitle('1. cable'))
    expect(screen.getByText(/Skipped — will be added/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create quotation' }))
    expect(sent(onSend)[0]).toEqual({ skipped: true, requestedText: 'cable', quantity: 4 })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText(/Skipped — will be added/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create quotation' })).toBeNull()
  })

  it('Use this is disabled while the quantity is invalid', () => {
    render(<QuotationResolver block={block([amb()])} />)
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '-1' } })
    expect(screen.getByRole('button', { name: 'Use this' })).toBeDisabled()
  })
})

describe('QuotationResolver unmatched lines and manual search', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => vi.useRealTimers())

  const unmatched = { requestedText: 'mystery part', qty: 2, requestedUnit: 'kg', status: 'unmatched' as const, candidates: [] }

  it('says no match was found and shows the requested unit', () => {
    render(<QuotationResolver block={block([unmatched])} />)
    expect(screen.getByText('No catalog match found')).toBeInTheDocument()
    expect(screen.getByText(/× 2 kg/)).toBeInTheDocument()
    expect(screen.getByText(/1 not found/)).toBeInTheDocument()
  })

  it('searches the catalog (debounced) and picks a result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ products: [{ id: 'p9', name: 'Found part', sku: 'F-9', base_price: 40, image_url: null }] }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<QuotationResolver block={block([unmatched])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search product catalog' }))
    fireEvent.change(screen.getByPlaceholderText('Search product catalog…'), { target: { value: 'part' } })
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(350)
    expect(fetchMock).toHaveBeenCalledWith('/api/products/search?q=part&limit=8')
    fireEvent.click(await screen.findByRole('button', { name: /Found part/ }))
    expect(screen.getByText(/F-9 · ₹40\.00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search different product' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(screen.getByText('2 pcs')).toBeInTheDocument()
  })

  it('shows no results when the search fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    render(<QuotationResolver block={block([unmatched])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search product catalog' }))
    fireEvent.change(screen.getByPlaceholderText('Search product catalog…'), { target: { value: 'x' } })
    await vi.advanceTimersByTimeAsync(350)
    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull())
    expect(screen.queryByRole('button', { name: /Found/ })).toBeNull()
  })

  it('hides the search again from the toggle', () => {
    render(<QuotationResolver block={block([unmatched])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search product catalog' }))
    expect(screen.getByPlaceholderText('Search product catalog…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide search' }))
    expect(screen.queryByPlaceholderText('Search product catalog…')).toBeNull()
  })
})

describe('QuotationResolver edge cases', () => {
  it('renders nothing without lines', () => {
    const { container } = render(<QuotationResolver block={{ type: 'quotation_resolver', lines: [], counts: { matched: 0, ambiguous: 0, unmatched: 0 } }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
