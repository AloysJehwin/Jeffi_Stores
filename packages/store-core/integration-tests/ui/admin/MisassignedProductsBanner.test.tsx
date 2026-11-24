import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Lists products sitting on a main category; pick a subcategory and Move PATCHes the product.

let canWrite = true
const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label="subcategory" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import MisassignedProductsBanner from '@/components/admin/MisassignedProductsBanner'

const products = [
  { id: 'p1', name: 'Hammer', category_id: 'c1', category_name: 'Tools' },
  { id: 'p2', name: 'Drill', category_id: 'c1', category_name: 'Tools' },
]
const categories = [
  { id: 'c1', name: 'Tools', parent_category_id: null },
  { id: 's1', name: 'Hand tools', parent_category_id: 'c1' },
  { id: 's2', name: 'Power tools', parent_category_id: 'c1' },
]
const fetchMock = vi.fn<(...a: any[]) => any>()

beforeEach(() => {
  canWrite = true
  vi.stubGlobal('fetch', fetchMock)
})

describe('MisassignedProductsBanner', () => {
  it('renders nothing when there are no products', () => {
    const { container } = render(<MisassignedProductsBanner products={[]} categories={categories} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the count, rows and subcategory options', () => {
    render(<MisassignedProductsBanner products={products} categories={categories} />)
    expect(screen.getByText('2 products assigned to a main category')).toBeInTheDocument()
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Hand tools' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Move' })[0]).toBeDisabled()
  })

  it('uses the singular for one product', () => {
    render(<MisassignedProductsBanner products={[products[0]]} categories={categories} />)
    expect(screen.getByText('1 product assigned to a main category')).toBeInTheDocument()
  })

  it('moves a product, then removes its row and refreshes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<MisassignedProductsBanner products={products} categories={categories} />)
    fireEvent.change(screen.getAllByLabelText('subcategory')[0], { target: { value: 's2' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[0])
    await waitFor(() => expect(screen.queryByText('Hammer')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/products/p1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ category_id: 's2' }) }))
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByText('Drill')).toBeInTheDocument()
  })

  it('shows the server error and keeps the row when the move fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Not allowed' }) })
    render(<MisassignedProductsBanner products={products} categories={categories} />)
    fireEvent.change(screen.getAllByLabelText('subcategory')[0], { target: { value: 's1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[0])
    expect(await screen.findByText('Not allowed')).toBeInTheDocument()
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('hides Move without products:write', () => {
    canWrite = false
    render(<MisassignedProductsBanner products={products} categories={categories} />)
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument()
  })

  it('can be dismissed', () => {
    const { container } = render(<MisassignedProductsBanner products={products} categories={categories} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(container.firstChild).toBeNull()
  })
})
