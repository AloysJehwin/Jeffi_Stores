import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useState } from 'react'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let gstEnabled = true
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { gstEnabled } }) }))
let scanner: { onScan: (c: string) => Promise<void> | void; enabled: boolean }
vi.mock('@/hooks/useBarcodeScanner', () => ({
  useBarcodeScanner: (o: any) => {
    scanner = o
  },
}))
vi.mock('@/components/ui/CopySku', () => ({ default: () => <i /> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder ?? `select-${options[0]?.label}`} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder ?? '—'}</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/AdminTypeahead', () => ({
  default: ({ value, onChange, onSelect, placeholder }: any) => (
    <div>
      <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      <button
        onClick={() =>
          onSelect({ id: 'p1|v1|100|18|9983|118|10|sv1|0|Large|', label: 'Hammer', sublabel: 'HM-1 · Tools' })
        }
      >
        pick-suggestion
      </button>
    </div>
  ),
}))

import LineItemsSection, {
  CUSTOM_UNIT_MAX,
  apiErrorMessage,
  fetchSeedLineItem,
  insufficientMessage,
  isBlankLine,
  isCustomLine,
  lineItemIssues,
  lineItemPayload,
  newCustomLineItem,
  newLineItem,
  seedLineItemFromSuggestion,
  validateDraftLines,
  validateLineItems,
  type LineItem,
  type SellUnit,
} from '@/components/admin/LineItemsSection'

const pcUnit: SellUnit = { unit: 'pc', display_label: 'Pc', factor: 1, dimension: 'count', is_base: true, min_qty: 1, max_qty: null, qty_step: 1 }
const boxUnit: SellUnit = { unit: 'box', display_label: 'Box', factor: 12, dimension: 'count', is_base: false, min_qty: 1, max_qty: 5, qty_step: 1 }

const line = (over: Partial<LineItem> = {}): LineItem => ({
  ...newLineItem(),
  id: over.id ?? Math.random().toString(36).slice(2),
  product_id: 'p1',
  product_name: 'Hammer',
  product_sku: 'HM-1',
  hsn_code: '8205',
  gst_rate: '18',
  quantity: 2,
  unit_price: 118,
  mrp: 118,
  available_units: [pcUnit],
  selected_unit_key: 'pc',
  buy_unit: 'pc',
  unit: 'PC',
  inventory_quantity: 10,
  ...over,
})

const J = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

describe('line item helpers', () => {
  it('classifies custom and blank lines', () => {
    expect(isBlankLine(newLineItem())).toBe(true)
    expect(isBlankLine(newCustomLineItem())).toBe(false)
    expect(isCustomLine(newCustomLineItem())).toBe(true)
    expect(isCustomLine({ ...newLineItem(), product_name: 'Freight' })).toBe(true)
    expect(isCustomLine(line())).toBe(false)
  })

  it('newCustomLineItem defaults', () => {
    expect(newCustomLineItem()).toMatchObject({ is_custom: true, gst_rate: '18', unit: 'PCS', product_id: null })
  })

  it('lineItemIssues reports each problem in admin wording', () => {
    expect(lineItemIssues(line())).toEqual([])
    expect(lineItemIssues({ ...newLineItem(), quantity: 0, unit_price: 0 })).toEqual([
      'Pick a product or add a custom item',
      'Quantity must be greater than 0',
      'Enter a rate greater than 0',
    ])
    expect(lineItemIssues({ ...newCustomLineItem(), product_name: ' ', quantity: 1, unit_price: 5 })).toContain('Enter an item name')
    expect(lineItemIssues(line({ unit_price: -1 }))).toContain('Rate cannot be negative')
    expect(lineItemIssues(line({ gst_rate: '50' }))).toContain('GST % must be between 0 and 40')
    expect(lineItemIssues(line({ discount_pct: 120 }))).toContain('Discount must be between 0 and 100%')
    expect(lineItemIssues({ ...newCustomLineItem(), product_name: 'X', unit_price: 5, unit: 'WAYTOOLONGUNIT' })).toContain(
      `Unit must be at most ${CUSTOM_UNIT_MAX} characters`
    )
  })

  it('drafts may lack a name and a rate', () => {
    expect(lineItemIssues({ ...newLineItem(), quantity: 1, unit_price: 0 }, { draft: true })).toEqual([])
    expect(lineItemIssues({ ...newLineItem(), quantity: 0 }, { draft: true })).toContain('Quantity must be greater than 0')
  })

  it('validateLineItems prefixes the first problem with the item number', () => {
    expect(validateLineItems([newLineItem()])).toBe('Add at least one line item')
    expect(validateLineItems([line(), line({ quantity: 0 })])).toBe('Item 2: Quantity must be greater than 0')
    expect(validateLineItems([newLineItem(), line()])).toBeNull()
  })

  it('validateDraftLines ignores blanks and half-filled lines', () => {
    expect(validateDraftLines([newLineItem(), { ...newCustomLineItem(), product_name: 'Freight' }])).toBeNull()
    expect(validateDraftLines([line({ unit_price: -5 })])).toBe('Item 1: Rate cannot be negative')
  })

  it('apiErrorMessage uses field errors, the fallback and the trace id on 5xx', () => {
    const res = (status: number, trace: string | null = null) => ({ status, headers: { get: () => trace } }) as any
    expect(apiErrorMessage(res(400), { error: 'Bad' }, 'Failed')).toBe('Bad')
    expect(apiErrorMessage(res(400), {}, 'Failed')).toBe('Failed')
    expect(apiErrorMessage(res(422), { fields: { 'items.1.unit_price': 'too low', other: 'x' } }, 'F')).toBe(
      'Item 2 rate: too low; other: x'
    )
    expect(apiErrorMessage(res(500, 'abc123'), { error: 'Boom' }, 'F')).toBe('Boom (ref abc123)')
    expect(apiErrorMessage(res(400, 'abc123'), { error: 'Boom' }, 'F')).toBe('Boom')
  })

  it('insufficientMessage joins shortfalls', () => {
    expect(insufficientMessage('Short', ['A: 1', 'B: 2'])).toBe('Short: A: 1; B: 2')
    expect(insufficientMessage('Short', undefined)).toBe('Short: ')
  })

  it('lineItemPayload sends store lines with MRP as the rate and custom lines as free text', () => {
    const store = lineItemPayload(line({ id: 't1', variant_id: 'v1', quantity: 3, discount_pct: 10 }))
    expect(store).toMatchObject({ product_id: 'p1', variant_id: 'v1', unit_price: 118, discount_pct: 10, is_custom: false, temp_id: 't1', quantity: 3 })
    const custom = lineItemPayload({ ...newCustomLineItem(), product_name: ' Freight ', unit: 'pcs', unit_price: '50' })
    expect(custom).toMatchObject({
      product_id: null, product_name: 'Freight', product_sku: '', unit: 'PCS', buy_unit: null, sell_unit_factor: 1, unit_price: 50, is_custom: true,
    })
  })

  it('seedLineItemFromSuggestion prices from MRP or from base price plus GST', () => {
    const a = seedLineItemFromSuggestion({ product_id: 'p', name: 'Pipe', variant_name: '2in', sku: 'P1', mrp: 200, base_price: 150, gst_percentage: 18, hsn_code: '7306' })
    expect(a).toMatchObject({ product_id: 'p', product_name: 'Pipe — 2in', unit_price: 200, mrp: 200, discount_pct: 25, gst_rate: '18', hsn_code: '7306' })
    const b = seedLineItemFromSuggestion({ product_id: 'p', name: 'Pipe', sku: 'P1', base_price: 100, gst_percentage: 12 })
    expect(b).toMatchObject({ unit_price: 112, mrp: 0, gst_rate: '12', discount_pct: 0 })
    const c = seedLineItemFromSuggestion({ product_id: 'p', name: 'Pipe', sku: 'P1', mrp: 100, base_price: 90, discount_pct: 5, serialized: true })
    expect(c).toMatchObject({ discount_pct: 5, serialized: true })
  })

  it('fetchSeedLineItem resolves through the scan endpoint', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue(J({ item: { product_id: 'p9', name: 'Saw', sku: 'S1', base_price: 100 } }))
    vi.stubGlobal('fetch', f)
    const item = await fetchSeedLineItem('p9', 'v9')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ code: 'v9' })
    expect(item).toMatchObject({ product_id: 'p9', product_name: 'Saw' })
    f.mockResolvedValue(J({}))
    await expect(fetchSeedLineItem('p9')).resolves.toBeNull()
    f.mockRejectedValue(new Error('x'))
    await expect(fetchSeedLineItem('p9')).resolves.toBeNull()
  })
})

describe('LineItemsSection', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  let units: any[]
  let resolveData: any
  let pickerProducts: any[]

  beforeEach(() => {
    gstEnabled = true
    scanner = { onScan: () => {}, enabled: false }
    units = [{ unit: 'pc', display_label: 'Pc', factor: 1, dimension: 'count', is_base: true, min_qty: 1, max_qty: null, qty_step: 1 }]
    resolveData = {
      kind: 'item',
      item: { id: 'p1', product_id: 'p1', name: 'Hammer', sku: 'HM-1', base_price: 100, mrp: 118, gst_percentage: 18, hsn_code: '8205', inventory_quantity: 10 },
    }
    pickerProducts = [
      { id: 'p1', product_id: 'p1', variant_id: null, name: 'Hammer', variant_name: null, sku: 'HM-1', base_price: 100, price_ex_gst: 100, mrp: 118, gst_percentage: 18, hsn_code: '8205', inventory_quantity: 7 },
      { id: 'v2', product_id: 'p2', variant_id: 'v2', name: 'Saw', variant_name: 'Small', sku: 'SW-S', base_price: 50, price_ex_gst: 50, mrp: 59, gst_percentage: 18, hsn_code: '8202', inventory_quantity: 3 },
      { id: 'v3', product_id: 'p2', variant_id: 'v3', name: 'Saw', variant_name: 'Large', sku: 'SW-L', base_price: null, price_ex_gst: null, mrp: null, gst_percentage: 18, hsn_code: '8202', inventory_quantity: 3 },
    ]
    fetchMock = vi.fn<(...a: any[]) => any>().mockImplementation(async (url: string) => {
      if (url === '/api/categories') return J({ categories: [{ id: 'c1', name: 'Hand tools' }] })
      if (/\/api\/admin\/products\/.+\/units/.test(url)) return J({ units })
      if (url === '/api/admin/scan/resolve') return J(resolveData)
      if (url.startsWith('/api/admin/labels/products')) return J({ products: pickerProducts })
      return J({})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  function Harness({ initial, spy, ...rest }: { initial: LineItem[]; spy?: (n: LineItem[]) => void } & Partial<React.ComponentProps<typeof LineItemsSection>>) {
    const [items, setItems] = useState(initial)
    return (
      <LineItemsSection
        items={items}
        onChange={n => {
          spy?.(n)
          setItems(n)
        }}
        {...rest}
      />
    )
  }

  const mount = (initial: LineItem[], extra: Partial<React.ComponentProps<typeof LineItemsSection>> & { spy?: any } = {}) =>
    render(<Harness initial={initial} {...extra} />)

  it('loads categories on mount and starts blank lines in Scanner mode', async () => {
    mount([newLineItem()])
    expect(screen.getByPlaceholderText('Scan a SKU / lot / serial…')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/categories', { credentials: 'include' }))
  })

  it('shows the product, variant, SKU, HSN and a green stock badge for a filled line', () => {
    mount([line({ variant_name: 'Large' })])
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    expect(screen.getByText('Large')).toBeInTheDocument()
    expect(screen.getByText('HM-1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('8205')).toBeInTheDocument()
    expect(screen.getByText('Stock: 10 pcs')).toHaveClass('text-green-700')
  })

  it('stock badge colours: low and out, and a clickable badge', () => {
    const onStockBadgeClick = vi.fn()
    const first = mount([line({ inventory_quantity: 3 })], { onStockBadgeClick })
    fireEvent.click(screen.getByRole('button', { name: 'Stock: 3 pcs' }))
    expect(onStockBadgeClick).toHaveBeenCalledTimes(1)
    first.unmount()
    mount([line({ inventory_quantity: 0 })], { onStockBadgeClick })
    expect(screen.getByText('Out of stock')).toHaveClass('text-red-600')
  })

  it('an assigned batch label replaces the stock badge', () => {
    const l = line({ id: 'L1' })
    mount([l], { assignedBatchLabels: { L1: 'LOT-9' } })
    expect(screen.getByRole('button', { name: 'Batch: LOT-9' })).toBeInTheDocument()
    expect(screen.queryByText(/Stock:/)).toBeNull()
  })

  it('pack units show total pieces and stock in units', () => {
    mount([line({ available_units: [boxUnit], selected_unit_key: 'box', buy_unit: 'box', quantity: 2, inventory_quantity: 20 })])
    expect(screen.getByText(/24 pcs total/)).toBeInTheDocument()
    expect(screen.getByText(/stock: 20 pcs/)).toHaveClass('text-amber-500')
    expect(screen.getByText('Stock: 1 Box')).toBeInTheDocument()
  })

  it('computes line total, taxable value, CGST/SGST and total with GST on', () => {
    mount([line({ quantity: 2 })])
    expect(screen.getByText('Taxable Value').nextSibling).toHaveTextContent('₹200.00')
    expect(screen.getByText('CGST').nextSibling).toHaveTextContent('₹18.00')
    expect(screen.getByText('SGST').nextSibling).toHaveTextContent('₹18.00')
    expect(screen.getByText('Total (incl. GST)').nextSibling).toHaveTextContent('₹236.00')
    expect(screen.getByText('Line total:').parentElement).toHaveTextContent('₹236.00')
  })

  it('with GST off it shows Subtotal, no GST column and an ex-GST total', () => {
    gstEnabled = false
    mount([line({ quantity: 2 })])
    expect(screen.getByText('Subtotal').nextSibling).toHaveTextContent('₹200.00')
    expect(screen.queryByText('CGST')).toBeNull()
    expect(screen.queryByLabelText('select-0%')).toBeNull()
    expect(screen.getByText('Total').nextSibling).toHaveTextContent('₹200.00')
    expect(screen.getByText(/^MRP/)).toBeInTheDocument()
  })

  it('shows discount, struck MRP and net price', () => {
    mount([line({ quantity: 1, discount_pct: 10 })])
    expect(screen.getByText('₹118.00')).toHaveClass('line-through')
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getAllByText('₹106.20').length).toBeGreaterThan(0)
  })

  it('editing HSN, rate and discount updates the line and totals', () => {
    const spy = vi.fn()
    mount([line({ quantity: 1 })], { spy })
    fireEvent.change(screen.getByDisplayValue('8205'), { target: { value: '8206' } })
    expect(spy.mock.lastCall![0][0].hsn_code).toBe('8206')
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '236' } })
    expect(screen.getByText('Total (incl. GST)').nextSibling).toHaveTextContent('₹236.00')
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '50' } })
    expect(screen.getByText('Total (incl. GST)').nextSibling).toHaveTextContent('₹118.00')
    fireEvent.change(screen.getByLabelText('select-0%'), { target: { value: '5' } })
    expect(spy.mock.lastCall![0][0].gst_rate).toBe('5')
  })

  it('quantity stepper follows the unit step, floor and cap and reports reductions', () => {
    const onQuantityReduced = vi.fn()
    const spy = vi.fn()
    mount([line({ id: 'L1', quantity: 2, available_units: [{ ...pcUnit, max_qty: 3 }] })], { onQuantityReduced, spy })
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Decrease quantity'))
    expect(onQuantityReduced).toHaveBeenCalledWith('L1', 2)
    fireEvent.click(screen.getByLabelText('Decrease quantity'))
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled()
  })

  it('typing a quantity snaps to the step grid on blur', () => {
    mount([line({ quantity: 2, available_units: [{ ...pcUnit, qty_step: 0.5, dimension: 'length', unit: 'm' }], selected_unit_key: 'm' })])
    const input = screen.getByDisplayValue('2')
    fireEvent.change(input, { target: { value: '2.3' } })
    fireEvent.blur(input)
    expect(screen.getByDisplayValue('2.5')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
  })

  it('a product with several count units lets the user switch unit', () => {
    const spy = vi.fn()
    mount([line({ available_units: [pcUnit, boxUnit] })], { spy })
    fireEvent.change(screen.getByLabelText('select-Pc'), { target: { value: 'box' } })
    const updated = spy.mock.lastCall![0][0]
    expect(updated).toMatchObject({ selected_unit_key: 'box', buy_unit: 'box', sell_unit_factor: 12, unit: 'BOX' })
  })

  it('add item, custom item and remove controls', () => {
    const spy = vi.fn()
    mount([line({ id: 'A' })], { spy })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /Add Item/ })[0])
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    expect(screen.queryByText('Item 2')).toBeNull()
  })

  it('the header custom item button drops blank lines and adds a custom one', () => {
    mount([line({ id: 'A' }), newLineItem()])
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '+ Custom item' })[0])
    expect(screen.getByText('Custom – not in inventory')).toBeInTheDocument()
    expect(screen.getAllByText(/^Item \d$/)).toHaveLength(2)
  })

  it('custom lines: name, uppercase unit, rate label, validation and navigation back to search', () => {
    mount([newLineItem()])
    fireEvent.click(screen.getAllByRole('button', { name: '+ Custom item' })[1])
    expect(screen.getByText('Custom – not in inventory')).toBeInTheDocument()
    expect(screen.getByText(/Rate \(incl\. GST\)/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. Installation charges'), { target: { value: 'Freight' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a rate greater than 0')
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '500' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('PCS'), { target: { value: 'kg' } })
    expect(screen.getByPlaceholderText('PCS')).toHaveValue('KG')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByPlaceholderText('e.g. Installation charges')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Search store instead' }))
    expect(screen.getByPlaceholderText('Scan a SKU / lot / serial…')).toBeInTheDocument()
  })

  it('search modes: name and SKU typeaheads populate the line, fetch units and merge duplicates', async () => {
    mount([newLineItem()])
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    fireEvent.click(screen.getByText('pick-suggestion'))
    expect(await screen.findByText('Stock: 10 pcs')).toBeInTheDocument()
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    expect(screen.getByText('HM-1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('9983')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => /products\/p1\/units\?chain=1&variant_id=v1&sub_variant_id=sv1/.test(String(c[0])))).toBe(true)
  })

  it('picking the same product on another line merges quantities', async () => {
    mount([line({ id: 'A', product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1', quantity: 2 }), newLineItem()])
    fireEvent.click(screen.getAllByRole('button', { name: 'SKU' })[0])
    fireEvent.click(screen.getByText('pick-suggestion'))
    await waitFor(() => expect(screen.queryByText('Item 2')).toBeNull())
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
  })

  it('category mode: choose a category, open the picker and pick a product', async () => {
    mount([newLineItem()])
    fireEvent.click(screen.getByRole('button', { name: 'Category' }))
    const select = await screen.findByLabelText('— Select category —')
    await screen.findByRole('option', { name: 'Hand tools' })
    const open = screen.getByRole('button', { name: 'Select Product' })
    expect(open).toBeDisabled()
    fireEvent.change(select, { target: { value: 'c1' } })
    fireEvent.click(open)
    expect(await screen.findByText('Select Product', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.getByText('Hand tools', { selector: 'p' })).toBeInTheDocument()
    expect(await screen.findByText('SW-S')).toBeInTheDocument()
    expect(screen.getByText('Saw', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('₹100')).toBeInTheDocument()
    expect(screen.getByText('—', { selector: 'td' })).toBeInTheDocument()
    expect(String(fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/admin/labels/products'))![0])).toContain('category_id=c1')
    fireEvent.click(screen.getByText('HM-1').closest('tr')!)
    await waitFor(() => expect(screen.queryByText('Select Product', { selector: 'h3' })).toBeNull())
    expect(await screen.findByText('Stock: 7 pcs')).toBeInTheDocument()
  })

  it('the product picker filters, shows an empty state and closes', async () => {
    mount([newLineItem()])
    fireEvent.click(screen.getByRole('button', { name: 'Category' }))
    await screen.findByRole('option', { name: 'Hand tools' })
    fireEvent.change(screen.getByLabelText('— Select category —'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Product' }))
    await screen.findByText('SW-S')
    pickerProducts = []
    fireEvent.change(screen.getByPlaceholderText('Filter by name or SKU…'), { target: { value: 'zzz' } })
    expect(await screen.findByText('No products found in this category.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('q=zzz'))).toBe(true)
    fireEvent.click(screen.getByText('Select Product', { selector: 'h3' }).closest('div')!.parentElement!.querySelector('button')!)
    expect(screen.queryByText('Select Product', { selector: 'h3' })).toBeNull()
  })

  it('Change clears the product back to search', () => {
    mount([line()])
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByPlaceholderText('Scan a SKU / lot / serial…')).toBeInTheDocument()
    expect(screen.queryByText('Hammer')).toBeNull()
  })

  it('backfills units for lines loaded without them', async () => {
    units = [{ unit: 'box', display_label: 'Box', factor: 1, dimension: 'count', is_base: true, min_qty: 1, max_qty: null, qty_step: 1 }]
    const spy = vi.fn()
    mount([line({ available_units: [], selected_unit_key: '', buy_unit: null, quantity: '2.6' })], { spy })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.lastCall![0][0]).toMatchObject({ selected_unit_key: 'box', buy_unit: 'box', unit: 'BOX', quantity: '3' })
  })

  it('the scan switch toggles the hardware scanner', () => {
    mount([newLineItem()])
    expect(scanner.enabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Scan: on' }))
    expect(scanner.enabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Scan: off' })).toBeInTheDocument()
  })

  it('a scanned product is added as a line; scanning it again bumps the quantity', async () => {
    mount([])
    await act(async () => {
      await scanner.onScan('HM-1')
    })
    expect(await screen.findByText('Hammer')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Added Hammer', 'success')
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
    await act(async () => {
      await scanner.onScan('HM-1')
    })
    await waitFor(() => expect(screen.getByDisplayValue('2')).toBeInTheDocument())
    expect(screen.getAllByText(/^Item \d$/)).toHaveLength(1)
  })

  it('an unknown scan toasts an error', async () => {
    resolveData = { kind: 'not_found' }
    mount([])
    await act(async () => {
      await scanner.onScan('???')
    })
    expect(showToast).toHaveBeenCalledWith('No product found for "???"', 'error')
  })

  it('a failed lookup toasts', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/scan/resolve') throw new Error('down')
      return J({ categories: [] })
    })
    mount([])
    await act(async () => {
      await scanner.onScan('X')
    })
    expect(showToast).toHaveBeenCalledWith('Scan lookup failed', 'error')
  })

  it('a lot scan adds the line and announces the lot', async () => {
    resolveData = { kind: 'batch', item: { ...resolveData.item, lot_number: 'LOT-5' } }
    mount([])
    await act(async () => {
      await scanner.onScan('LOT-5')
    })
    expect(showToast).toHaveBeenCalledWith('Lot LOT-5 → Hammer', 'info')
  })

  it('serial scans are reported to the parent, and a repeat of the same serial is rejected', async () => {
    resolveData = { kind: 'serial', serial: { serial_number: 'SN1', serial_id: 's1', product_id: 'p1', product_name: 'Hammer', status: 'in_stock' }, item: resolveData.item }
    const onSerialScanned = vi.fn()
    mount([], { onSerialScanned })
    await act(async () => {
      await scanner.onScan('SN1')
    })
    expect(onSerialScanned).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ serial_number: 'SN1', serial_id: 's1' }))
    await act(async () => {
      await scanner.onScan('SN1')
    })
    expect(showToast).toHaveBeenCalledWith('Serial SN1 already scanned', 'error')
    expect(onSerialScanned).toHaveBeenCalledTimes(1)
  })

  it('rejects serials that are sold or reserved', async () => {
    resolveData = { kind: 'serial', serial: { serial_number: 'SN2', product_id: 'p1', status: 'sold' }, item: resolveData.item }
    mount([])
    await act(async () => {
      await scanner.onScan('SN2')
    })
    expect(showToast).toHaveBeenCalledWith('Serial SN2 is already sold', 'error')
  })

  it('Scanner mode fills the line on Enter and appends a fresh scanner line', async () => {
    mount([newLineItem()])
    const box = screen.getByPlaceholderText('Scan a SKU / lot / serial…')
    fireEvent.change(box, { target: { value: 'HM-1' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Hammer')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('Scan a SKU / lot / serial…')).toHaveLength(1)
  })

  it('Scanner mode clears the field when nothing matches', async () => {
    resolveData = { kind: 'not_found' }
    mount([newLineItem()])
    const box = screen.getByPlaceholderText('Scan a SKU / lot / serial…')
    fireEvent.change(box, { target: { value: 'nope' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('renders an expandable assignment panel with a Ready / Needed summary', () => {
    mount([line({ id: 'L1' })], {
      renderLineAssignment: it => <div>panel for {it.id}</div>,
      lineAssignmentSummary: () => ({ label: '1 of 2 serials', complete: false }),
    })
    expect(screen.getByText('1 of 2 serials')).toBeInTheDocument()
    expect(screen.getByText('Needed')).toBeInTheDocument()
    expect(screen.queryByText('panel for L1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /1 of 2 serials/ }))
    expect(screen.getByText('panel for L1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1 of 2 serials/ }))
    expect(screen.queryByText('panel for L1')).toBeNull()
  })

  it('shows Ready when complete and a default label without a summary; skips lines with no panel', () => {
    const first = mount([line({ id: 'L1' })], {
      renderLineAssignment: () => <div>p</div>,
      lineAssignmentSummary: () => ({ label: '2 of 2 serials', complete: true }),
    })
    expect(screen.getByText('Ready')).toBeInTheDocument()
    first.unmount()
    const second = mount([line({ id: 'L2' })], { renderLineAssignment: () => <div>p</div> })
    expect(screen.getByText('Assign serials / batch')).toBeInTheDocument()
    second.unmount()
    mount([line({ id: 'L3' })], { renderLineAssignment: () => null })
    expect(screen.queryByText('Assign serials / batch')).toBeNull()
  })
})
