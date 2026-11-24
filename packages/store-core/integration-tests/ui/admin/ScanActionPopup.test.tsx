import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let search = 'scan_pid=p1&scan_vid=v1&x=1'
const replace = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/products',
}))
vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))

import ScanActionPopup from '@/components/admin/ScanActionPopup'

const product = {
  product_id: 'p1', variant_id: 'v1', name: 'Hammer', variant_name: '500g', sku: 'HAM-500',
  base_price: 450, mrp: 500, inventory_quantity: 12, brand_name: 'Acme',
}
const fetchMock = vi.fn<(...a: any[]) => any>()

beforeEach(() => {
  search = 'scan_pid=p1&scan_vid=v1&x=1'
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({ json: async () => ({ product }) })
})

describe('ScanActionPopup', () => {
  it('renders nothing without scan params', () => {
    search = 'x=1'
    const { baseElement } = render(<ScanActionPopup role="staff" scopes={[]} host="h" />)
    expect(baseElement.textContent).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('looks the product up, then shows price, MRP and stock', async () => {
    render(<ScanActionPopup role="staff" scopes={['products:write']} host="h" />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('Hammer')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/scan/product?pid=p1&vid=v1')
    expect(screen.getByText('500g')).toBeInTheDocument()
    expect(screen.getByText('HAM-500 · Acme')).toBeInTheDocument()
    expect(screen.getByText(/450/)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('offers only the actions the role is scoped for, with product query links', async () => {
    render(<ScanActionPopup role="staff" scopes={['products:write', 'inventory:read']} host="h" />)
    await screen.findByText('Hammer')
    expect(screen.getByRole('link', { name: 'Edit Product' })).toHaveAttribute('href', '/admin/products/p1/edit')
    expect(screen.getByRole('link', { name: 'View Stock' })).toHaveAttribute('href', '/admin/inventory?tab=ledger&ledger_search=HAM-500')
    expect(screen.queryByRole('link', { name: 'New Invoice' })).not.toBeInTheDocument()
  })

  it('links sales actions with the product and variant for a fully scoped admin', async () => {
    render(<ScanActionPopup role="administrator" scopes={[]} host="h" />)
    await screen.findByText('Hammer')
    expect(screen.getByRole('link', { name: 'New Cash Sale' })).toHaveAttribute('href', '/admin/cash-sale?product=p1&variant=v1')
    expect(screen.getAllByRole('link')).toHaveLength(6)
  })

  it('says so when the user has no permitted actions', async () => {
    render(<ScanActionPopup role="staff" scopes={[]} host="h" />)
    expect(await screen.findByText(/don't have permission for any product actions/)).toBeInTheDocument()
  })

  it('shows not-found for an unknown label and on fetch failure', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({}) })
    const { unmount } = render(<ScanActionPopup role="staff" scopes={[]} host="h" />)
    expect(await screen.findByText(/Product not found for the scanned label/)).toBeInTheDocument()
    unmount()
    fetchMock.mockRejectedValueOnce(new Error('x'))
    render(<ScanActionPopup role="staff" scopes={[]} host="h" />)
    expect(await screen.findByText(/Product not found for the scanned label/)).toBeInTheDocument()
  })

  it('looks up by sku alone', async () => {
    search = 'scan_sku=HAM-500'
    render(<ScanActionPopup role="staff" scopes={[]} host="h" />)
    await screen.findByText('Hammer')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/scan/product?sku=HAM-500')
  })

  it('closes via the X, the backdrop and Escape, stripping only the scan params', async () => {
    render(<ScanActionPopup role="staff" scopes={[]} host="h" />)
    await screen.findByText('Hammer')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(replace).toHaveBeenLastCalledWith('/admin/products?x=1', { scroll: false })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(replace).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText('Scanned product').closest('.fixed')!)
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(3))
  })

  it('closes to the bare path when no other params remain', async () => {
    search = 'scan_pid=p1'
    render(<ScanActionPopup role="staff" scopes={[]} host="h" />)
    await screen.findByText('Hammer')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(replace).toHaveBeenCalledWith('/admin/products', { scroll: false })
  })
})
