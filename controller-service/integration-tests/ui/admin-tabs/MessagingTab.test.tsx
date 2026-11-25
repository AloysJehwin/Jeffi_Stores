import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('@/components/admin/messaging-templates/TemplateEditor', () => ({
  default: (p: any) => (
    <div data-testid="editor">
      editing {p.value.slug || '(new)'}
      <button type="button" onClick={() => p.onSave(true)}>
        Save template
      </button>
    </div>
  ),
  toEditorTemplate: (t: any) => ({ id: t.id, slug: t.slug, channel: t.channel, name: t.name, subject: '', body: '' }),
}))
vi.mock('@/components/admin/messaging-templates/PhonePreview', () => ({ default: ({ body }: any) => <div data-testid="phone">{body}</div> }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: () => null }))

import MessagingTab from '@controller/components/admin/ecom/tabs/MessagingTab'

const BASE = '/api/admin/ecom/customers/t1/messaging'
const settings = (over: Record<string, unknown> = {}) => ({ standard_templates: 'all', allowed: [], editing_enabled: true, review_required: false, ...over })
const catalog: Record<string, any[]> = {
  email: [
    { id: 'e1', slug: 'order/confirmed', name: 'Order confirmed', channel: 'email', source: 'platform' },
    { id: 'e2', slug: 'order/shipped', name: 'Order shipped', channel: 'email', source: 'tenant', review_status: 'pending' },
  ],
  sms: [{ id: 's1', slug: 'otp', name: 'OTP', channel: 'sms', source: 'platform' }],
  whatsapp: [],
}
const review = (over: Record<string, unknown> = {}) => ({
  id: 'r1', channel: 'sms', slug: 'otp', name: 'OTP', review_status: 'pending', review_note: null, proposed_version: 3, proposed_subject: null, proposed_body: 'Your code is {{code}}',
  live_version: null, live_subject: null, live_body: null, ...over,
})

type Routes = { settings?: any; reviews?: any[]; put?: any; decide?: { ok: boolean }; open?: { ok: boolean; body?: any }; del?: { ok: boolean } }
function mockApi(r: Routes = {}) {
  const f = vi.fn<(...a: any[]) => any>(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET'
    const ok = (body: any, good = true) => ({ ok: good, status: good ? 200 : 400, json: async () => body })
    if (url === `${BASE}/v2/settings` && method === 'GET') return ok(r.settings ?? settings())
    if (url === `${BASE}/v2/settings` && method === 'PUT') return ok(r.put ?? JSON.parse(init.body), !(r.put && r.put.message))
    if (url === `${BASE}/v2/templates/review`) return ok({ items: r.reviews ?? [] })
    if (url.includes('/review') && method === 'POST') return ok({}, r.decide?.ok ?? true)
    if (url.startsWith(`${BASE}/v2/templates?channel=`)) return ok({ items: catalog[url.split('=')[1]] })
    if (method === 'DELETE') return ok({}, r.del?.ok ?? true)
    if (url.startsWith(`${BASE}/v2/templates/email/`)) return ok(r.open?.body ?? { id: 'e1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed' }, r.open?.ok ?? true)
    return ok({})
  })
  vi.stubGlobal('fetch', f)
  return f
}
const view = () =>
  render(
    <ToastProvider>
      <MessagingTab tenantId="t1" storeName="Acme" />
    </ToastProvider>,
  )

describe('MessagingTab', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  it('shows a loading skeleton, then the access toggles and "All" standard templates', async () => {
    mockApi()
    view()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(await screen.findByText('The customer sees and can send every standard template.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Customer can create and edit templates/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /Review customer changes/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: /Save settings/ })).toBeDisabled()
  })

  it('saves toggled settings with a PUT and confirms', async () => {
    const f = mockApi()
    view()
    fireEvent.click(await screen.findByRole('switch', { name: /Review customer changes/ }))
    const save = screen.getByRole('button', { name: /Save settings/ })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    expect(await screen.findByText('Messaging settings saved')).toBeInTheDocument()
    const put = f.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body)).toMatchObject({ review_required: true, editing_enabled: true })
  })

  it('toasts a failed save', async () => {
    mockApi({ put: { message: 'Policy locked' } })
    view()
    fireEvent.click(await screen.findByRole('switch', { name: /Customer can create/ }))
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }))
    expect(await screen.findByText('Policy locked')).toBeInTheDocument()
  })

  it('lets the admin pick only some standard templates per channel, with a filter', async () => {
    const f = mockApi()
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Only selected' }))
    const confirmed = await screen.findByRole('checkbox', { name: /Order confirmed/ })
    expect(confirmed).not.toBeChecked()
    fireEvent.click(confirmed)
    expect(confirmed).toBeChecked()
    fireEvent.change(screen.getByLabelText('Filter templates'), { target: { value: 'shipped' } })
    expect(screen.queryByRole('checkbox', { name: /Order confirmed/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter templates'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Clear shown/ }))
    expect(screen.getByRole('checkbox', { name: /Order confirmed/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /Tick all shown/ }))
    expect(screen.getByRole('checkbox', { name: /Order shipped/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /^SMS/ }))
    expect(screen.getByRole('checkbox', { name: /OTP/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }))
    await screen.findByText('Messaging settings saved')
    const body = JSON.parse(f.mock.calls.find(c => c[1]?.method === 'PUT')![1].body)
    expect(body.standard_templates).toBe('selected')
    expect(body.allowed).toEqual(expect.arrayContaining([{ channel: 'email', slug: 'order/confirmed' }, { channel: 'email', slug: 'order/shipped' }]))
  })

  it('review tab: empty state mentions that review is off', async () => {
    mockApi()
    view()
    await screen.findByText(/every standard template/)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findByText(/Nothing waiting for review/)).toHaveTextContent('Review is off for this customer')
  })

  it('review tab: shows the pending count, approves a proposal', async () => {
    const f = mockApi({ reviews: [review()] })
    view()
    expect(await screen.findByText('1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
    expect(await screen.findByText('Waiting for review')).toBeInTheDocument()
    expect(screen.getByText('Proposed · v3')).toBeInTheDocument()
    expect(screen.getByText(/No approved version yet/)).toBeInTheDocument()
    expect(screen.getByTestId('phone')).toHaveTextContent('Your code is {{code}}')
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(await screen.findByText('Approved — the customer can send it now')).toBeInTheDocument()
    const post = f.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe(`${BASE}/v2/templates/r1/review`)
    expect(JSON.parse(post[1].body)).toEqual({ decision: 'approved' })
  })

  it('review tab: rejecting needs a note and sends it to the customer', async () => {
    const f = mockApi({ reviews: [review()] })
    view()
    fireEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Reject/ }))
    const send = screen.getByRole('button', { name: /Send/ })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/What should they change/), { target: { value: 'Remove the link' } })
    fireEvent.click(send)
    expect(await screen.findByText('Rejected — the customer sees your note')).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls.find(c => c[1]?.method === 'POST')![1].body)).toEqual({ decision: 'rejected', note: 'Remove the link' })
  })

  it('review tab: a rejected row shows its note and no actions; email shows subject and live version', async () => {
    mockApi({ reviews: [review({ channel: 'email', review_status: 'rejected', review_note: 'Too long', live_version: 2, live_subject: 'Hello', live_body: '<p>hi</p>', proposed_subject: 'Hello 2' })] })
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    expect(await screen.findByText('Rejected — Too long')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(screen.getByText('Live · v2')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('templates tab: lists customer and standard copies, opens one for editing and archives', async () => {
    const f = mockApi()
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }))
    expect(screen.getByText(/Pick a template to view or edit/)).toBeInTheDocument()
    const row = await screen.findByRole('button', { name: /Order confirmed/ })
    expect(within(row).getByText('Standard')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Order shipped/ })).getByText('Customer')).toBeInTheDocument()
    fireEvent.click(row)
    expect(await screen.findByTestId('editor')).toHaveTextContent('editing order/confirmed')
    fireEvent.click(screen.getByRole('button', { name: /Archive customer copy/ }))
    expect(await screen.findByText('Archived — the standard template applies again')).toBeInTheDocument()
    expect(f.mock.calls.some(c => c[1]?.method === 'DELETE' && String(c[0]).endsWith('/v2/templates/email/order%2Fconfirmed'))).toBe(true)
  })

  it('templates tab: filter, new template and save', async () => {
    const f = mockApi()
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }))
    await screen.findByRole('button', { name: /Order confirmed/ })
    fireEvent.change(screen.getAllByLabelText('Filter templates').at(-1)!, { target: { value: 'nomatch' } })
    expect(screen.queryByRole('button', { name: /Order confirmed/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    expect(screen.getByTestId('editor')).toHaveTextContent('(new)')
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Saved for the customer (approved).')).toBeInTheDocument()
    expect(f.mock.calls.some(c => c[1]?.method === 'POST' && c[0] === `${BASE}/v2/templates`)).toBe(true)
  })

  it('templates tab: toasts when a template cannot be opened', async () => {
    mockApi({ open: { ok: false } })
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }))
    fireEvent.click(await screen.findByRole('button', { name: /Order confirmed/ }))
    expect(await screen.findByText('Could not open that template')).toBeInTheDocument()
  })
})
