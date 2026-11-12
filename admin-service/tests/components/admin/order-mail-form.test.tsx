import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite, useCanUseAi: () => true }))
// The rich editor and the AI helper are their own components; here they stand in as plain fields.
const composerProps = vi.hoisted(() => ({ last: null as null | { extraVariables?: { key: string }[] } }))
vi.mock('@/components/admin/email-composer/EmailComposer', () => ({
  default: (p: { value: string; onChange: (v: string) => void; extraVariables?: { key: string }[] }) => {
    composerProps.last = p
    return <textarea aria-label="Message" value={p.value} onChange={e => p.onChange(e.target.value)} />
  },
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: { children?: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/admin/AdminSelect', () => ({ default: () => null }))

import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { ToastProvider } from '@/contexts/ToastContext'
import OrderMailForm, { type MailTarget } from '@admin/app/(admin)/admin/orders/_components/OrderMailForm'

const fetchMock = vi.fn()
const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const calls = (method: string) => fetchMock.mock.calls.filter(c => (c[1]?.method ?? 'GET') === method).map(c => String(c[0]))
const sendBody = (url: string) => JSON.parse(fetchMock.mock.calls.find(c => String(c[0]) === url && c[1]?.method === 'POST')![1].body)

const DELAY = {
  slug: 'order/delay-shipping',
  name: 'Shipping delay',
  subject: 'Your order {{order_number}} is delayed',
  preheader: '',
  body: '<p>Sorry {{customer_first_name}}</p>',
  layout: 'store',
  scenario: { id: 'delay_shipping', label: 'Shipping delay', reply: 'order_delay' },
  fits: true,
}
const LIST: MailTarget = { kind: 'list', query: 'status=shipped&sort=created&dir=desc' }
const ORDER: MailTarget = { kind: 'order', orderId: 'o-1', orderNumber: 'ORD-1', customerName: 'Alice', customerEmail: 'alice@example.com' }

function mount(target: MailTarget, onSent = vi.fn()) {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <OrderMailForm target={target} active onSent={onSent} onClose={() => {}} />
      </ConfirmProvider>
    </ToastProvider>
  )
  return onSent
}

beforeEach(() => {
  canWrite = true
  composerProps.last = null
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OrderMailForm for a list of orders', () => {
  const listApi = (count = 3, extra: Record<string, unknown> = {}) =>
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/preview')) return ok({ html: '<p>preview</p>', missing: [], sample: { orderNumber: 'ORD-9' } })
      if (init?.method === 'POST') return ok({ success: true, done: true, sent: count, summary: `Emailed ${count} of ${count} orders.` })
      return ok({ count, capped: false, cap: 500, sample: count ? { orderNumber: 'ORD-9' } : null, templates: [DELAY], ...extra })
    })

  it('loads the count and templates for the list’s own filters and says who gets the email', async () => {
    listApi()
    mount(LIST)
    expect(await screen.findByText('3 orders')).toBeTruthy()
    expect(calls('GET')).toEqual(['/api/admin/orders/bulk-mail?status=shipped&sort=created&dir=desc'])
    expect(screen.getByText('Order templates')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Send to 3 orders/ })).toBeTruthy()
    // The order's own details are offered in the editor's Insert variable menu.
    expect(composerProps.last?.extraVariables?.map(v => v.key)).toEqual(expect.arrayContaining(['tracking_url', 'expected_delivery', 'order_date', 'total']))
  })

  it('sends a chosen template to the filtered orders only after the administrator confirms', async () => {
    listApi()
    const onSent = mount(LIST)
    fireEvent.click(await screen.findByRole('button', { name: 'Shipping delay' }))
    fireEvent.click(screen.getByRole('button', { name: /Send to 3 orders/ }))
    // Nothing is sent until the confirmation.
    expect(await screen.findByText('Email 3 orders?')).toBeTruthy()
    expect(calls('POST').filter(u => !u.includes('/preview'))).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Send 3 emails' }))

    await waitFor(() => expect(onSent).toHaveBeenCalled())
    const url = '/api/admin/orders/bulk-mail?status=shipped&sort=created&dir=desc'
    expect(sendBody(url)).toMatchObject({
      subject: 'Your order {{order_number}} is delayed',
      body: '<p>Sorry {{customer_first_name}}</p>',
      layout: 'template',
      scenario: 'delay_shipping',
      count: 3,
    })
  })

  it('does not send when the administrator backs out of the confirmation', async () => {
    listApi()
    const onSent = mount(LIST)
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: '<p>Hello</p>' } })
    fireEvent.click(screen.getByRole('button', { name: /Send to 3 orders/ }))
    await screen.findByText('Email 3 orders?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Email 3 orders?')).toBeNull())
    expect(calls('POST').filter(u => !u.includes('/preview'))).toEqual([])
    expect(onSent).not.toHaveBeenCalled()
  })

  it('cannot send when no order matches, or when more than the cap match', async () => {
    listApi(0)
    mount(LIST)
    expect(await screen.findByText('No orders match the current filters.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '<p>Hello</p>' } })
    expect((screen.getByRole('button', { name: /Send to 0 orders/ }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    listApi(500, { capped: true })
    mount(LIST)
    expect(await screen.findByText(/More than 500 orders match/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '<p>Hello</p>' } })
    expect((screen.getByRole('button', { name: /Send to 500 orders/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('warns, without blocking, when the first order has nothing for a token', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/preview')
        ? ok({ html: '<p>x</p>', missing: ['tracking_url'], sample: { orderNumber: 'ORD-9' } })
        : ok({ count: 2, capped: false, cap: 500, sample: { orderNumber: 'ORD-9' }, templates: [] })
    )
    mount(LIST)
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: '<p>Track: {{tracking_url}}</p>' } })
    expect(await screen.findByText(/An order with nothing for a token is skipped/, {}, { timeout: 2000 })).toBeTruthy()
    expect((screen.getByRole('button', { name: /Send to 2 orders/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('OrderMailForm for one order (the order page)', () => {
  it('keeps the order page’s behaviour: its own endpoints, the fitting template first, no confirmation', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/preview')) return ok({ html: '<p>x</p>', missing: [] })
      if (init?.method === 'POST') return ok({ success: true })
      return ok({ order: { status: 'shipped', paymentStatus: 'paid', email: 'alice@example.com' }, items: [], templates: [DELAY] })
    })
    const onSent = mount(ORDER)
    expect(await screen.findByText('For this order')).toBeTruthy()
    expect(calls('GET')).toEqual(['/api/admin/orders/o-1/mail-templates'])
    // The template that suits the order is preselected, so its subject is already filled in.
    expect(await screen.findByDisplayValue('Your order {{order_number}} is delayed')).toBeTruthy()
    const send = screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement
    await waitFor(() => expect(send.disabled).toBe(false), { timeout: 2000 })
    fireEvent.click(send)
    await waitFor(() => expect(onSent).toHaveBeenCalled())
    const body = sendBody('/api/admin/orders/o-1/send-customer-mail')
    expect(body).toMatchObject({ layout: 'template', scenario: 'delay_shipping', isHtml: true })
    expect(body.count).toBeUndefined()
  })

  it('hides Send from an administrator who cannot write', async () => {
    canWrite = false
    fetchMock.mockImplementation(() => ok({ order: { status: 'shipped', paymentStatus: 'paid', email: 'a@b.c' }, items: [], templates: [] }))
    mount(ORDER)
    await screen.findByLabelText('Message')
    expect(screen.queryByRole('button', { name: 'Send email' })).toBeNull()
  })
})
