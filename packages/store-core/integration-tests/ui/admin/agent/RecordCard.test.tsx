import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import { RecordCard, RecordCards, type CardData } from '@/components/admin/agent/RecordCard'

const card = (o: Partial<CardData> = {}): CardData => ({
  title: 'Invoice INV-7',
  subtitle: 'For Acme',
  eyebrow: 'Invoice',
  entity: { kind: 'invoice', id: '7' },
  badges: [{ label: 'Paid', tone: 'success' }],
  stats: [
    { label: 'Total', value: 1500, format: 'inr', delta: 12.5, hint: 'vs last month' },
    { label: 'Items', value: 3, format: 'number', delta: -4 },
  ],
  fields: [
    { label: 'Customer', value: 'Priya', entity: { kind: 'customer', id: 'c1' } },
    { label: 'Date', value: '2026-01-05', format: 'date' },
    { label: 'Share', value: 40, format: 'percent' },
    { label: 'Empty', value: '' },
  ],
  note: 'Overdue by 3 days',
  ...o,
})

describe('RecordCard', () => {
  it('renders the header with eyebrow, a linked title, subtitle and badges', () => {
    render(<RecordCard card={card()} />)
    expect(screen.getByText('Invoice', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Invoice INV-7' })).toHaveAttribute('href', '/admin/invoices/7/view')
    expect(screen.getByText('For Acme')).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()
  })

  it('formats stats and shows deltas with their direction', () => {
    render(<RecordCard card={card()} />)
    expect(screen.getByText('₹1,500.00')).toBeInTheDocument()
    expect(screen.getByText('12.5%')).toHaveClass('text-green-700')
    expect(screen.getByText('4%')).toHaveClass('text-red-600')
    expect(screen.getByText('vs last month')).toBeInTheDocument()
  })

  it('formats fields and links an entity field', () => {
    render(<RecordCard card={card()} />)
    expect(screen.getByRole('link', { name: 'Priya' })).toHaveAttribute('href', '/admin/customers/c1/view')
    expect(screen.getByText('5 Jan 2026')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('Empty').nextElementSibling).toHaveTextContent('—')
  })

  it('shows the note', () => {
    render(<RecordCard card={card()} />)
    expect(screen.getByText('Overdue by 3 days')).toBeInTheDocument()
  })

  it('shows a progress bar with values', () => {
    render(<RecordCard card={card({ progress: { label: 'Collected', value: 600, max: 1500 } })} />)
    expect(screen.getByText('Collected')).toBeInTheDocument()
    expect(screen.getByText('600 / 1,500')).toBeInTheDocument()
  })

  it('shows only the first items and expands the rest', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ title: `Row ${i + 1}`, value: i + 1, format: 'number' as const }))
    render(<RecordCard card={card({ items })} />)
    expect(screen.queryByText('Row 7')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 9' }))
    expect(screen.getByText('Row 9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('Row 7')).toBeNull()
  })

  it('renders item badges, subtitles and links, and only accepts safe image urls', () => {
    const items = [
      { title: 'Shirt', subtitle: 'Red', badge: { label: 'Low', tone: 'warn' }, entity: { kind: 'product', id: 'p1' }, image_url: 'https://cdn.example/a.png' },
      { title: 'Shoe', image_url: 'javascript:alert(1)' },
    ]
    const { container } = render(<RecordCard card={card({ items, image_url: '//evil.example/x.png' })} />)
    expect(screen.getByRole('link', { name: /Shirt/ })).toHaveAttribute('href', '/admin/products/p1')
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/a.png')
  })

  it('opens https links in a new tab with noopener', () => {
    render(<RecordCard card={card({ href: 'https://example.com/doc', entity: undefined })} />)
    const a = screen.getByRole('link', { name: /Invoice INV-7/ })
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('prompt actions send a chat message, and are dropped without a handler', () => {
    const onSend = vi.fn()
    const actions = [{ label: 'Send reminder', prompt: 'Remind Acme about INV-7' }, { label: 'Open', href: '/admin/invoices/7/view' }, { label: 'Bad', href: 'javascript:alert(1)' }]
    const { rerender } = render(<RecordCard card={card({ actions })} onSendMessage={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: /Send reminder/ }))
    expect(onSend).toHaveBeenCalledWith('Remind Acme about INV-7')
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByText('Bad')).toBeNull()
    rerender(<RecordCard card={card({ actions })} />)
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull()
  })

  it('shows a tone border and tone coloured note', () => {
    const { container } = render(<RecordCard card={card({ tone: 'error' })} />)
    expect(container.firstElementChild).toHaveClass('border-l-red-500')
    expect(screen.getByText('Overdue by 3 days')).toHaveClass('text-red-600')
  })

  it('works with just a title', () => {
    render(<RecordCard card={{ title: 'Bare' }} />)
    expect(screen.getByText('Bare')).toBeInTheDocument()
  })
})

describe('RecordCards', () => {
  it('renders one card per entry, skipping untitled ones, as list or grid', () => {
    const { container, rerender } = render(<RecordCards block={{ type: 'cards', cards: [{ title: 'A' }, { title: '' }, { title: 'B' }] }} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('grid')
    rerender(<RecordCards block={{ type: 'cards', layout: 'list', cards: [{ title: 'A' }] }} />)
    expect(container.firstElementChild).toHaveClass('space-y-2')
    expect(within(container as HTMLElement).queryByText('B')).toBeNull()
  })
})
