import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/admin/ImageUrlInput', () => ({
  default: ({ value, onChange }: any) => <input aria-label="image-url" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ fieldLabel }: any) => <i>{`ai:${fieldLabel}`}</i> }))
vi.mock('@/components/admin/email-composer/EmailComposer', () => ({
  default: ({ value, onChange }: any) => <textarea aria-label="rich-text" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="sel" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/messaging-templates/ScenarioFillDialog', () => ({
  default: ({ open, applyFill }: any) => (open ? <button onClick={() => applyFill({ body: '<p>AI drafted</p>' })}>apply-scenario</button> : null),
}))

import EmailBlockBuilder from '@/components/admin/email-composer/EmailBlockBuilder'

describe('EmailBlockBuilder', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>())
  })

  it('shows the empty hint and the block palette', () => {
    render(<EmailBlockBuilder blocks={[]} onChange={vi.fn()} />)
    expect(screen.getByText(/Add blocks above to build your email/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Heading/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Product rows/ })).toBeInTheDocument()
  })

  it('hides palette types on request', () => {
    render(<EmailBlockBuilder blocks={[]} onChange={vi.fn()} hideTypes={['product_rows', 'product_card']} />)
    expect(screen.queryByRole('button', { name: /Product rows/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Coupon/ })).toBeInTheDocument()
  })

  it('appends a new block from the palette', () => {
    const onChange = vi.fn()
    render(<EmailBlockBuilder blocks={[{ type: 'divider' }]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Button/ }))
    expect(onChange).toHaveBeenCalledWith([{ type: 'divider' }, { type: 'cta_button', text: 'Shop now', url: '{ctaUrl}' }])
  })

  it('edits heading text and alignment, and removes a block', () => {
    const onChange = vi.fn()
    render(<EmailBlockBuilder blocks={[{ type: 'heading', text: 'Hi', align: 'left' }, { type: 'divider' }]} onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText(/Heading text/), { target: { value: 'Hello' } })
    expect(onChange).toHaveBeenLastCalledWith([{ type: 'heading', text: 'Hello', align: 'left' }, { type: 'divider' }])
    fireEvent.change(screen.getByLabelText('sel'), { target: { value: 'center' } })
    expect(onChange).toHaveBeenLastCalledWith([{ type: 'heading', text: 'Hi', align: 'center' }, { type: 'divider' }])
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove block' })[0])
    expect(onChange).toHaveBeenLastCalledWith([{ type: 'divider' }])
    expect(screen.getByText('ai:Email heading')).toBeInTheDocument()
  })

  it('edits image, button, coupon and text blocks', () => {
    const onChange = vi.fn()
    const blocks = [
      { type: 'image', url: 'https://cdn/a.png', alt: '', width: 560 },
      { type: 'cta_button', text: 'Go', url: '/x' },
      { type: 'coupon', heading: 'Code', note: '' },
      { type: 'text', html: '<p>Body</p>' },
    ] as never
    render(<EmailBlockBuilder blocks={blocks} onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Alt text'), { target: { value: 'Drill' } })
    expect(onChange.mock.lastCall![0][0]).toMatchObject({ alt: 'Drill' })
    fireEvent.change(screen.getByPlaceholderText(/Button URL/), { target: { value: '{ctaUrl}' } })
    expect(onChange.mock.lastCall![0][1]).toMatchObject({ url: '{ctaUrl}' })
    fireEvent.change(screen.getByPlaceholderText(/Small print/), { target: { value: 'Till Sunday' } })
    expect(onChange.mock.lastCall![0][2]).toMatchObject({ note: 'Till Sunday' })
    fireEvent.change(screen.getByLabelText('rich-text'), { target: { value: '<p>New</p>' } })
    expect(onChange.mock.lastCall![0][3]).toMatchObject({ html: '<p>New</p>' })
  })

  it('searches products for a product-picker block and adds one', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ items: [{ url: '/products/drill', name: 'Cordless drill', price: '4999', image: null }] }) } as never)
    const onChange = vi.fn()
    render(<EmailBlockBuilder blocks={[{ type: 'products', items: [], columns: 2 }]} onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search products by name or SKU'), { target: { value: 'dri' } })
    fireEvent.click(await screen.findByText('Cordless drill', undefined, { timeout: 2000 }))
    expect(onChange).toHaveBeenCalledWith([{ type: 'products', items: [{ url: '/products/drill', name: 'Cordless drill', price: '4999', image: null }], columns: 2 }])
  })

  it('opens scenario fill for a new template and replaces the blocks, with undo available', async () => {
    const onChange = vi.fn()
    render(<EmailBlockBuilder blocks={[{ type: 'divider' }]} onChange={onChange} scenarioFill={{ tenantContext: {} as never }} />)
    fireEvent.click(screen.getByRole('button', { name: /Fill from scenario/ }))
    fireEvent.click(screen.getByText('apply-scenario'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ type: 'text', html: '<p>AI drafted</p>' }]))
  })

  it('hides the scenario opener on an existing template', () => {
    render(<EmailBlockBuilder blocks={[]} onChange={vi.fn()} scenarioFill={{ tenantContext: {} as never, isNewTemplate: false }} />)
    expect(screen.queryByRole('button', { name: /Fill from scenario/ })).not.toBeInTheDocument()
  })
})
