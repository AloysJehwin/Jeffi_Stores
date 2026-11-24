import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/ui/CopySku', () => ({ default: ({ sku }: any) => <i data-testid="copy">{sku}</i> }))
vi.mock('@/components/admin/agent/DocumentBlock', () => ({ default: ({ block }: any) => <i data-testid="doc">{block.type}</i> }))
vi.mock('@/components/admin/agent/ChangeSummaryBlock', () => ({ default: ({ block }: any) => <i data-testid="chg">{block.type}</i> }))
vi.mock('@/components/admin/agent/QuotationResolver', () => ({
  default: ({ onSendMessage }: any) => <button onClick={() => onSendMessage?.('resolved')}>quotation-resolver</button>,
}))
vi.mock('@/components/admin/agent/RecordCard', () => ({
  RecordCard: ({ onSendMessage }: any) => <button onClick={() => onSendMessage?.('card')}>record-card</button>,
  RecordCards: ({ onSendMessage }: any) => <button onClick={() => onSendMessage?.('cards')}>record-cards</button>,
}))

import AdminAgentBlocks, { type UiBlock } from '@/components/admin/AdminAgentBlocks'

const r = (blocks: any[], props: Partial<React.ComponentProps<typeof AdminAgentBlocks>> = {}) =>
  render(<AdminAgentBlocks blocks={blocks as UiBlock[]} {...props} />)

describe('AdminAgentBlocks', () => {
  it('renders text with weight variants and headings', () => {
    r([
      { type: 'text', value: 'plain' },
      { type: 'text', value: 'strong', weight: 'bold' },
      { type: 'text', value: 'quiet', weight: 'muted' },
      { type: 'heading', value: 'H1', level: 1 },
      { type: 'heading', value: 'H3', level: 3 },
    ])
    expect(screen.getByText('strong')).toHaveClass('font-semibold')
    expect(screen.getByText('quiet')).toHaveClass('text-xs')
    expect(screen.getByText('plain')).toHaveClass('text-sm')
    expect(screen.getByText('H1')).toHaveClass('text-base')
    expect(screen.getByText('H3')).toHaveClass('uppercase')
  })

  it('renders key/value pairs and tables', () => {
    r([
      { type: 'kv_pairs', pairs: [{ key: 'Status', value: 'Paid' }] },
      { type: 'table', headers: ['SKU', 'Qty'], rows: [['A-1', 4]] },
    ])
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'SKU' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument()
  })

  it('renders a product grid with price, stock status, link and fallbacks', () => {
    r([
      {
        type: 'product_grid',
        products: [
          { id: 'p1', name: 'Shirt', sku: 'SH-1', price: '1,299', stock_status: 'Low Stock', inventory_qty: 3, image_url: 'https://cdn.test/s.jpg', subtitle: 'Blue' },
          { id: 'p2', name: 'Mug', price: 0, stock: 0 },
          { id: 'p3', name: 'Cap', price: 200, stock: 12 },
          { id: 'p4', name: 'Pen' },
        ],
      },
    ])
    expect(screen.getByText('Shirt').closest('a')).toHaveAttribute('href', '/admin/products/p1')
    expect(screen.getByText('₹1,299.00')).toBeInTheDocument()
    expect(screen.getByText('Low Stock · 3 on hand')).toHaveClass('text-amber-600')
    expect(screen.getByTestId('copy')).toHaveTextContent('SH-1')
    expect(screen.getByText('Blue')).toBeInTheDocument()
    expect(screen.getAllByText('Price on request')).toHaveLength(2)
    expect(screen.getByText('Out of stock')).toHaveClass('text-red-600')
    expect(screen.getByText('12 in stock')).toBeInTheDocument()
    expect(screen.getByText('Stock —')).toBeInTheDocument()
  })

  it('marks out-of-stock status in red', () => {
    r([{ type: 'product_grid', products: [{ id: 'p1', name: 'X', stock_status: 'Out of Stock' }] }])
    expect(screen.getByText('Out of Stock')).toHaveClass('text-red-600')
  })

  it('renders the customer list with links and optional columns', () => {
    r([
      {
        type: 'customer_list',
        customers: [
          { id: 'c1', name: 'Asha', email: 'a@x.test', phone: '99999', total_orders: 4, lifetime_value: 2500 },
          { id: 'c2', email: 'b@x.test' },
        ],
      },
    ])
    expect(screen.getByText('Asha').closest('a')).toHaveAttribute('href', '/admin/customers/c1/view')
    expect(screen.getByText('a@x.test · 99999')).toBeInTheDocument()
    expect(screen.getByText('₹2,500.00')).toBeInTheDocument()
    expect(screen.getAllByText('b@x.test').length).toBeGreaterThan(0)
    expect(screen.getAllByText('orders')).toHaveLength(1)
  })

  it('renders the order list', () => {
    r([
      {
        type: 'order_list',
        orders: [{ id: 'o1', order_number: 'ORD-1', status: 'Shipped', total: 500, customer_name: 'Asha', created_at: '2026-01-02T00:00:00Z' }],
      },
    ])
    expect(screen.getByText('ORD-1 · Asha').closest('a')).toHaveAttribute('href', '/admin/orders/o1/view')
    expect(screen.getByText(/Shipped ·/)).toBeInTheDocument()
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
  })

  it('choice picker calls back with the kind and option, and hides once resolved', () => {
    const onPick = vi.fn()
    const block = {
      type: 'choice_picker',
      choice_kind: 'customer',
      note: 'several matches',
      options: [{ id: 'c1', label: 'Asha', sublabel: 'asha@x.test' }],
    }
    const first = r([block], { onPickOption: onPick })
    expect(screen.getByText(/Pick a customer — several matches/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Asha/ }))
    expect(onPick).toHaveBeenCalledWith('customer', { id: 'c1', label: 'Asha' })
    first.unmount()
    const second = r([block], { pickerResolved: true })
    expect(second.container.textContent).toBe('')
  })

  it.each([
    ['info', 'text-blue-900'],
    ['warn', 'text-amber-900'],
    ['error', 'text-red-900'],
    ['success', 'text-green-900'],
  ])('renders a %s callout', (tone, cls) => {
    r([{ type: 'callout', tone, message: `msg-${tone}`, title: `title-${tone}` }])
    expect(screen.getByText(`msg-${tone}`).closest('.rounded-lg')!.className).toContain(cls)
    expect(screen.getByText(`title-${tone}`)).toBeInTheDocument()
  })

  it('renders code, link buttons and image cards', () => {
    r([
      { type: 'code_block', content: 'SELECT 1' },
      { type: 'link_button', label: 'Open it', href: '/admin/orders' },
      { type: 'image_card', image_url: 'https://cdn.test/i.png', title: 'Hero', subtitle: 'sub', href: '/x' },
      { type: 'image_card', image_url: 'https://cdn.test/j.png', title: 'Plain' },
    ])
    expect(screen.getByText('SELECT 1').tagName).toBe('PRE')
    expect(screen.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/admin/orders')
    expect(screen.getByText('Hero').closest('a')).toHaveAttribute('href', '/x')
    expect(screen.getByText('Plain').closest('a')).toBeNull()
  })

  it('delegates rich blocks and forwards onSendMessage', () => {
    const send = vi.fn()
    r(
      [
        { type: 'quotation_resolver' },
        { type: 'document' },
        { type: 'change_summary' },
        { type: 'card' },
        { type: 'cards' },
      ],
      { onSendMessage: send }
    )
    expect(screen.getByTestId('doc')).toHaveTextContent('document')
    expect(screen.getByTestId('chg')).toHaveTextContent('change_summary')
    fireEvent.click(screen.getByText('quotation-resolver'))
    fireEvent.click(screen.getByText('record-card'))
    fireEvent.click(screen.getByText('record-cards'))
    expect(send.mock.calls.map(c => c[0])).toEqual(['resolved', 'card', 'cards'])
  })

  it('flags unknown block types', () => {
    r([{ type: 'mystery' }])
    expect(screen.getByText('[unknown block type: mystery]')).toBeInTheDocument()
  })

  it('renders nothing for an empty list', () => {
    const { container } = r([])
    expect(container.querySelector('.space-y-3')!.children).toHaveLength(0)
  })
})
