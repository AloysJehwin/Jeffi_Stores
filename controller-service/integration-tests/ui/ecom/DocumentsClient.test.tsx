import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@controller/app/(ecom)/ecom/dashboard/documents/DesignsPanel', () => ({ default: (p: any) => <div data-testid="designs">designs {p.seller?.name ?? 'no seller'}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/documents/BulkDocuments', () => ({ default: (p: any) => <div data-testid="bulk">bulk balance {p.balance}</div> }))

import DocumentsClient from '@controller/app/(ecom)/ecom/dashboard/documents/DocumentsClient'

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', type: 'tax_invoice', number: 'INV-0001', template: 'classic', totals: { total: 1180 }, pdf_url: 'https://cdn/x.pdf', view_url: 'https://app/view/d1', price_inr: 2, created_at: '2026-11-20T10:00:00Z', ...over,
})
const mockDocs = (pages: Array<{ items: any[]; next_cursor?: string | null }>) => {
  let i = 0
  const f = vi.fn<(...a: any[]) => any>(async () => ({ json: async () => pages[Math.min(i++, pages.length - 1)] }))
  vi.stubGlobal('fetch', f)
  return f
}
const view = () => render(<DocumentsClient seller={{ name: 'Acme' } as any} prices={{ invoice: 2 }} balance={500} />)

describe('DocumentsClient', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/dashboard/documents')
  })

  it('lists rendered documents with number, amount, price and View/PDF links', async () => {
    mockDocs([{ items: [doc()] }])
    view()
    expect(screen.getByText('Developers')).toBeInTheDocument()
    expect(await screen.findByText('INV-0001')).toBeInTheDocument()
    expect(screen.getByText('tax invoice')).toBeInTheDocument()
    expect(screen.getByText('₹1,180.00')).toBeInTheDocument()
    expect(screen.getByText('₹2.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', 'https://app/view/d1')
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', 'https://cdn/x.pdf')
  })

  it('shows the empty state with a link to create an API key', async () => {
    mockDocs([{ items: [] }])
    view()
    expect(await screen.findByText('No documents yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create an API key' })).toHaveAttribute('href', '/dashboard/api-keys')
  })

  it('pages with the cursor the API returned', async () => {
    const f = mockDocs([{ items: [doc()], next_cursor: 'abc' }, { items: [doc({ id: 'd2', number: 'INV-0002' })] }])
    view()
    await screen.findByText('INV-0001')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('INV-0002')).toBeInTheDocument()
    expect(f.mock.calls[1][0]).toContain('cursor=abc')
    expect(screen.getByText('Page 2')).toBeInTheDocument()
  })

  it('switching to Designs and Bulk shows those panels and records the section in the URL hash', async () => {
    mockDocs([{ items: [] }])
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Designs' }))
    expect(screen.getByTestId('designs')).toHaveTextContent('designs Acme')
    expect(location.hash).toBe('#designs')
    fireEvent.click(screen.getByRole('tab', { name: 'Bulk' }))
    expect(screen.getByTestId('bulk')).toHaveTextContent('bulk balance 500')
    expect(location.hash).toBe('#bulk')
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }))
    expect(location.hash).toBe('')
  })

  it('opens on the section named in the URL hash', async () => {
    history.replaceState(null, '', '/dashboard/documents#bulk')
    mockDocs([{ items: [] }])
    view()
    expect(await screen.findByTestId('bulk')).toBeInTheDocument()
  })
})
