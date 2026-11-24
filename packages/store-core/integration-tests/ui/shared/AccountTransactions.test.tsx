import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const useAuthMock = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => <div>visitor-header</div> }))
vi.mock('@/components/business/AccountMobileHeader', () => ({ default: () => <div>business-header</div> }))
vi.mock('@/components/visitor/skeletons/account', () => ({ TransactionsSkeleton: ({ portal }: any) => <div>skeleton:{portal}</div> }))

import { AccountTransactionsVisitor, AccountTransactionsBusiness } from '@/components/shared/AccountTransactions'

const txn = (over: Record<string, any> = {}) => ({
  id: 't1',
  transactionId: 'pay_ABC123',
  paymentMethod: 'upi',
  paymentGateway: 'razorpay',
  amount: 1499,
  status: 'completed',
  createdAt: '2026-03-05T10:15:00Z',
  updatedAt: '2026-03-05T10:15:00Z',
  orderId: 'o1',
  orderNumber: 'JS-1001',
  ...over,
})
const respond = (transactions: any[], total = transactions.length) =>
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ transactions, total })))

describe('AccountTransactions', () => {
  beforeEach(() => {
    push.mockClear()
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('shows a skeleton while auth or the first page loads', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: true })
    render(<AccountTransactionsVisitor />)
    expect(screen.getByText('skeleton:store')).toBeInTheDocument()
  })

  it('lists transactions with status, method, amount, order link and reference', async () => {
    respond([txn(), txn({ id: 't2', status: 'pending', paymentMethod: 'cod', paymentGateway: '', orderId: 'o2', orderNumber: 'JS-1002', transactionId: '' })])
    render(<AccountTransactionsVisitor />)
    expect(await screen.findByText('Order #JS-1001')).toHaveAttribute('href', '/account/orders/o1')
    expect(screen.getByText('Order #JS-1002')).toHaveAttribute('href', '/account/orders/o2')
    expect(screen.getAllByText(/1,499/)).toHaveLength(2)
    expect(screen.getByText('TXN: pay_ABC123')).toBeInTheDocument()
    expect(screen.getAllByText('Razorpay').length).toBeGreaterThan(0)
    expect(screen.getByText('Cash on Delivery', { selector: 'span.ui-badge' })).toBeInTheDocument()
    expect(screen.getByText('visitor-header')).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/transactions?page=1')
  })

  it('filters by status and by payment method', async () => {
    respond([
      txn(),
      txn({ id: 't2', status: 'failed', paymentMethod: 'cod', paymentGateway: '', orderNumber: 'JS-1002' }),
      txn({ id: 't3', status: 'refunded', orderNumber: 'JS-1003' }),
    ])
    render(<AccountTransactionsVisitor />)
    await screen.findByText('Order #JS-1001')

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(screen.queryByText('Order #JS-1001')).toBeNull()
    expect(screen.getByText('Order #JS-1002')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Razorpay' } })
    expect(screen.getByText('Order #JS-1001')).toBeInTheDocument()
    expect(screen.getByText('Order #JS-1003')).toBeInTheDocument()
    expect(screen.queryByText('Order #JS-1002')).toBeNull()
  })

  it('has no method filter when every payment used the same method', async () => {
    respond([txn(), txn({ id: 't2', orderNumber: 'JS-1002' })])
    render(<AccountTransactionsVisitor />)
    await screen.findByText('Order #JS-1001')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows an empty state with a link to browse products', async () => {
    respond([])
    render(<AccountTransactionsVisitor />)
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse Products' })).toHaveAttribute('href', '/products')
  })

  it('sends signed-out visitors to the login page', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false })
    const { container } = render(<AccountTransactionsVisitor />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?redirect=/account/transactions'))
    expect(container).toBeEmptyDOMElement()
  })

  it('uses the business header, portal header and credentials on the business portal', async () => {
    respond([txn()])
    render(<AccountTransactionsBusiness />)
    expect(await screen.findByText('Order #JS-1001')).toHaveAttribute('href', expect.stringContaining('/account/orders/o1'))
    expect(screen.getByText('business-header')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { 'X-Auth-Portal': 'business' } })
  })

  it('sends signed-out business users to the business sign-in', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false })
    render(<AccountTransactionsBusiness />)
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('signin?callbackUrl=/business/account/transactions')))
  })

  it('shows a retryable error when a later page cannot be loaded', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ transactions: [txn()], total: 3 })))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    render(<AccountTransactionsVisitor />)
    await screen.findByText('Order #JS-1001')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load transactions')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ transactions: [txn({ id: 't9', orderNumber: 'JS-1009' })], total: 3 })))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Order #JS-1009')).toBeInTheDocument()
  })
})
