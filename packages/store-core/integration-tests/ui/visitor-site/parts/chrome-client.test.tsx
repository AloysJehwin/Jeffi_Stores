import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  cart: null as any,
  auth: null as any,
  push: vi.fn(),
  portal: 'storefront',
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuthOptional: () => m.auth }))
vi.mock('@/contexts/CartContext', () => ({ useCartOptional: () => m.cart }))
vi.mock('@/components/visitor/SearchBar', () => ({
  default: ({ isOpen, onOpen, onClose }: any) => (
    <div>
      <span data-testid="search-open">{String(isOpen)}</span>
      <button onClick={onOpen}>open search</button>
      <button onClick={onClose}>close search</button>
    </div>
  ),
}))
vi.mock('@/components/visitor/MobileDrawer', () => ({
  default: ({ isOpen, onClose }: any) => (isOpen ? <div role="dialog"><button onClick={onClose}>close drawer</button></div> : null),
}))
vi.mock('@/components/visitor/site/code/parts/chrome/CartLink', () => ({
  default: ({ count, showCount, className }: any) => <a href="/cart" data-testid="cart" data-count={count} data-show={String(showCount)} className={className}>cart</a>,
}))
vi.mock('@/lib/site/portal', () => ({ portalHere: () => m.portal }))

import {
  CartIconPart,
  SearchBoxPart,
  MenuButtonPart,
  AnnouncementTextPart,
  AccountLinkPart,
  NewsletterFormPart,
} from '@/components/visitor/site/code/parts/chrome/client'

const fetchMock = vi.fn()
beforeEach(() => {
  m.cart = null
  m.auth = null
  m.portal = 'storefront'
  m.push.mockClear()
  fetchMock.mockReset().mockResolvedValue({ ok: false, json: async () => null })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CartIconPart', () => {
  it('shows the real cart count, or the demo count outside the store providers', () => {
    const { rerender } = render(<CartIconPart demoCount={2} />)
    expect(screen.getByTestId('cart')).toHaveAttribute('data-count', '2')
    m.cart = { cartCount: 5 }
    rerender(<CartIconPart demoCount={2} showCount={false} className="extra" />)
    expect(screen.getByTestId('cart')).toHaveAttribute('data-count', '5')
    expect(screen.getByTestId('cart')).toHaveAttribute('data-show', 'false')
    expect(screen.getByTestId('cart').className).toContain('extra')
  })
})

describe('SearchBoxPart', () => {
  it('opens and closes the expanding search in the icon variant', () => {
    render(<SearchBoxPart />)
    expect(screen.getByTestId('search-open')).toHaveTextContent('false')
    fireEvent.click(screen.getByText('open search'))
    expect(screen.getByTestId('search-open')).toHaveTextContent('true')
    fireEvent.click(screen.getByText('close search'))
    expect(screen.getByTestId('search-open')).toHaveTextContent('false')
  })

  it('searches products from the always-open bar, ignoring an empty query', () => {
    render(<SearchBoxPart variant="bar" placeholder="Find tools" />)
    const field = screen.getByPlaceholderText('Find tools')
    fireEvent.submit(screen.getByRole('search'))
    expect(m.push).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: ' power drill ' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(m.push).toHaveBeenCalledWith('/products?search=power%20drill')
  })
})

describe('MenuButtonPart', () => {
  it('names the button with the cart count and opens the drawer', () => {
    m.cart = { cartCount: 3 }
    render(<MenuButtonPart />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu, 3 in cart' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close drawer'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is inert outside the store providers', () => {
    render(<MenuButtonPart from="md" />)
    const button = screen.getByRole('button', { name: 'Open menu' })
    expect(button).toHaveClass('md:hidden')
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('AnnouncementTextPart', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('rotates through the messages and wraps around', () => {
    render(<AnnouncementTextPart messages={['Free shipping', 'New arrivals']} interval={3} />)
    expect(screen.getByText('Free shipping')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('New arrivals')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('Free shipping')).toBeInTheDocument()
  })

  it('does not rotate a single message, links it when given a href, and hides when empty', () => {
    const { container, rerender } = render(<AnnouncementTextPart messages={['Sale on']} href="/sale" />)
    expect(screen.getByRole('link', { name: 'Sale on' })).toHaveAttribute('href', '/sale')
    expect(vi.getTimerCount()).toBe(0)
    rerender(<AnnouncementTextPart messages={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('AccountLinkPart', () => {
  it('shows the label with a person icon to a guest', () => {
    render(<AccountLinkPart label="Account" />)
    const link = screen.getByRole('link', { name: 'Account' })
    expect(link).toHaveAttribute('href', '/account')
    expect(link.querySelector('svg')).toBeInTheDocument()
  })

  it('greets a signed-in shopper by first name, or the email\'s local part', () => {
    m.auth = { user: { firstName: ' Asha ', email: 'asha@x.co' } }
    const { rerender } = render(<AccountLinkPart label="Account" />)
    expect(screen.getByRole('link', { name: 'Your account, Asha' })).toHaveTextContent('AAsha')
    m.auth = { user: { firstName: '', email: 'ravi@x.co' } }
    rerender(<AccountLinkPart label="Account" />)
    expect(screen.getByRole('link', { name: 'Your account, ravi' })).toBeInTheDocument()
  })

  it('shows the guest view in the studio preview, and just an icon without a label', () => {
    m.auth = { user: { firstName: 'Asha', email: 'a@x.co' } }
    render(<AccountLinkPart label="" preview />)
    const link = screen.getByRole('link', { name: 'Account' })
    expect(link).toHaveTextContent('')
  })
})

describe('NewsletterFormPart', () => {
  const props = { placeholder: 'Your email', button: 'Subscribe' }
  const type = (v: string) => fireEvent.change(screen.getByPlaceholderText('Your email'), { target: { value: v } })

  it('rejects an invalid email', () => {
    render(<NewsletterFormPart {...props} />)
    type('nope')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Your email')).toHaveAttribute('aria-invalid', 'true')
    expect(m.push).not.toHaveBeenCalled()
  })

  it('sends a guest to sign up with their email and the page to come back to', () => {
    render(<NewsletterFormPart {...props} />)
    type('asha@x.co')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(m.push).toHaveBeenCalledWith(`/signup?email=asha%40x.co&redirect=${encodeURIComponent(window.location.pathname)}`)
  })

  it('uses the business sign-up on the business portal', () => {
    m.portal = 'business'
    render(<NewsletterFormPart {...props} />)
    type('asha@x.co')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(m.push.mock.calls[0][0]).toContain('/business/signup?email=asha%40x.co')
  })

  it('says it is a preview and sends nothing', () => {
    render(<NewsletterFormPart {...props} preview />)
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(screen.getByText('This is a preview: sign-ups work once your store is live.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('switches the offers on in one tap for a signed-in shopper', async () => {
    m.auth = { user: { email: 'asha@x.co' } }
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ categories: [{ category: 'offers', email: false }] }) })
    fetchMock.mockResolvedValueOnce({ ok: true })
    render(<NewsletterFormPart {...props} />)
    const field = screen.getByPlaceholderText('Your email')
    expect(field).toHaveValue('asha@x.co')
    expect(field).toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Done: our offers will reach you at asha@x.co.')
    const put = fetchMock.mock.calls[1]
    expect(put[0]).toBe('/api/user/notification-preferences')
    expect(put[1].method).toBe('PUT')
    expect(JSON.parse(put[1].body)).toEqual({ categories: [{ category: 'offers', email: true }] })
  })

  it('reports a failed switch-on', async () => {
    m.auth = { user: { email: 'asha@x.co' } }
    fetchMock.mockResolvedValueOnce({ ok: false })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    render(<NewsletterFormPart {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByText('That did not go through. Please try again.')).toBeInTheDocument()
  })

  it('tells a shopper who already gets the offers, instead of asking again', async () => {
    m.auth = { user: { email: 'asha@x.co' } }
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ categories: [{ category: 'offers', email: true }] }) })
    render(<NewsletterFormPart {...props} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('You get our offers at asha@x.co.'))
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
  })
})
