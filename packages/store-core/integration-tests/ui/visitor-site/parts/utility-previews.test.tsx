import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/site/card', () => ({ siteCard: async () => null }))
vi.mock('@/components/visitor/site/code/common/SiteCard', () => ({
  ProductItem: ({ product }: any) => <div data-testid="product-item">{product.name}</div>,
}))
vi.mock('@/components/visitor/site/code/common/tiles', () => ({ ImagePlaceholder: () => <i data-testid="placeholder" /> }))

import {
  SignInPreview,
  SignUpPreview,
  AccountPreview,
  OrderPreview,
  WishlistPreview,
  ComparePreview,
  LegalPreview,
  ReturnsPreview,
  SupportPreview,
} from '@/components/visitor/site/code/parts/utility/previews'

const product = (n: number, over: any = {}) => ({
  id: `p${n}`,
  name: `Product ${n}`,
  image: n === 1 ? null : `/p${n}.jpg`,
  brand: 'Brand',
  category: 'Cat',
  price: { value: 100 * n, formatted: `₹${100 * n}.00` },
  inStock: n !== 2,
  rating: n === 1 ? 4.5 : null,
  ...over,
})
const dataWith = (list: any[]) => ({ products: vi.fn(async (o: any) => list.slice(0, o?.limit ?? list.length)) }) as any
const three = [product(1), product(2), product(3)]

describe('SignInPreview / SignUpPreview', () => {
  it('sign-in shows the Google button, contact field, OTP channels and a create-account prompt', () => {
    render(<SignInPreview store="Jeffi" />)
    expect(screen.getByText('Sign in to your Jeffi account')).toHaveClass('sr-only')
    expect(screen.getByText('Email or Mobile Number')).toBeInTheDocument()
    for (const c of ['Email', 'SMS', 'WhatsApp']) expect(screen.getByText(c)).toBeInTheDocument()
    expect(screen.getByText('Send OTP')).toBeInTheDocument()
    expect(screen.getByText('Create one')).toBeInTheDocument()
  })

  it('sign-up shows the account form for the store', () => {
    render(<SignUpPreview store="Jeffi" />)
    expect(screen.getByText(/Jeffi/)).toBeInTheDocument()
  })

  it('nothing in them is a real control', () => {
    const { container } = render(<SignInPreview store="Jeffi" />)
    expect(container.querySelector('button, input, a')).toBeNull()
  })
})

describe('AccountPreview', () => {
  it('shows the sample customer, order stats and recent orders from the catalogue', async () => {
    render(await AccountPreview({ data: dataWith(three) }))
    expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThan(0)
    expect(screen.getAllByText('priya.sharma@example.com').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Total Orders').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    expect(screen.getByText('Product 2')).toBeInTheDocument()
    expect(screen.getAllByText('Shipped').length).toBeGreaterThan(0)
    expect(screen.getByText('Default Address')).toBeInTheDocument()
    expect(screen.getByText('Recent Orders')).toBeInTheDocument()
  })

  it('says there are no orders when the catalogue is empty or fails', async () => {
    render(await AccountPreview({ data: dataWith([]) }))
    expect(screen.getByText('No orders yet')).toBeInTheDocument()
    const failing = { products: vi.fn().mockRejectedValue(new Error('x')) } as any
    const { container } = render(await AccountPreview({ data: failing }))
    expect(container).toHaveTextContent('No orders yet')
  })
})

describe('OrderPreview', () => {
  it('shows the order status, tracking steps, items, address and payment', async () => {
    render(await OrderPreview({ data: dataWith(three) }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Order #ORD48213/)
    for (const s of ['Ordered', 'Confirmed', 'Shipped', 'Out for delivery', 'Delivered']) expect(screen.getAllByText(s).length).toBeGreaterThan(0)
    expect(screen.getByText('Product 1')).toBeInTheDocument()
    expect(screen.getByText('Qty 2')).toBeInTheDocument()
    expect(screen.getByText('Track shipment')).toBeInTheDocument()
    expect(screen.getByText('Delivery Address')).toBeInTheDocument()
    expect(screen.getByText('Paid by UPI')).toBeInTheDocument()
    expect(screen.queryByText('Product 3')).toBeNull() // two lines only
  })

  it('still draws the page when the catalogue is empty', async () => {
    render(await OrderPreview({ data: dataWith([]) }))
    expect(screen.getByText('Items')).toBeInTheDocument()
  })
})

describe('WishlistPreview', () => {
  it('draws the filter chips and each product with its wishlist line', async () => {
    render(await WishlistPreview({ data: dataWith([product(1), product(2), product(3), product(4)]) }))
    for (const chip of ['All', 'In Stock', 'Out of Stock']) expect(screen.getByText(chip)).toBeInTheDocument()
    expect(screen.getAllByTestId('product-item')).toHaveLength(4)
    expect(screen.getByText('Price dropped 8%')).toBeInTheDocument()
    expect(screen.getByText('Back in stock')).toBeInTheDocument()
    expect(screen.getAllByText('× Remove')).toHaveLength(4)
  })

  it('shows the empty wishlist state with no products', async () => {
    render(await WishlistPreview({ data: dataWith([]) }))
    expect(screen.getByText('Your wishlist is empty')).toBeInTheDocument()
    expect(screen.getByText('Browse Products')).toBeInTheDocument()
  })
})

describe('ComparePreview', () => {
  it('draws a column per product and the rows that tell them apart', async () => {
    render(await ComparePreview({ data: dataWith(three) }))
    expect(screen.getAllByTestId('product-item')).toHaveLength(3)
    const labels = Array.from(document.querySelectorAll('tbody tr td:first-child')).map(td => td.textContent)
    expect(labels).toEqual(['Brand', 'Category', 'Price', 'Availability', 'Rating'])
    expect(screen.getByText('₹200.00')).toBeInTheDocument()
    expect(screen.getByText('Out of stock')).toBeInTheDocument()
    expect(screen.getAllByText('In stock')).toHaveLength(2)
    expect(screen.getByText('4.5 / 5')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBe(2) // no rating for products 2 and 3
  })
})

describe('LegalPreview / ReturnsPreview / SupportPreview', () => {
  it('lists the six policies and a support prompt', () => {
    render(<LegalPreview />)
    expect(screen.getByRole('heading', { level: 1, name: /Policies/ })).toBeInTheDocument()
    for (const p of ['Privacy Policy', 'Terms & Conditions', 'Return & Refund Policy', 'Shipping Policy', 'Cancellation Policy', 'FAQ']) {
      expect(screen.getByRole('heading', { name: p })).toBeInTheDocument()
    }
    expect(screen.getByText('Contact Support')).toBeInTheDocument()
  })

  it('shows how to start a return in three steps and the policy sections', () => {
    render(<ReturnsPreview />)
    expect(screen.getByRole('heading', { name: 'How to start a return' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Open the order in My Orders')).toBeInTheDocument()
    for (const t of ['Overview', 'Eligibility', 'Refunds']) expect(screen.getByRole('heading', { name: t })).toBeInTheDocument()
    expect(screen.getByText('Go to my orders')).toBeInTheDocument()
  })

  it('support shows the store\'s own contact details when it has them', () => {
    render(<SupportPreview store={{ phone: '+91 99999 11111', email: 'help@store.test', address: '1 Main St' } as any} />)
    expect(screen.getByText('+91 99999 11111')).toBeInTheDocument()
    expect(screen.getByText('help@store.test')).toBeInTheDocument()
    expect(screen.getByText('1 Main St')).toBeInTheDocument()
    expect(screen.getByText('Quick Links')).toBeInTheDocument()
    expect(screen.getByText('Legal & Policies')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Chat with us' })).toBeInTheDocument()
    expect(screen.getByText('Hi! How can we help you today?')).toBeInTheDocument()
  })

  it('support shows stand-ins when the store has no contact details', () => {
    render(<SupportPreview store={null} />)
    expect(screen.getByText('Your phone number')).toBeInTheDocument()
    expect(screen.getByText('Your email address')).toBeInTheDocument()
    expect(screen.queryByText('Address')).toBeNull()
  })
})
