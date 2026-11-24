import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

vi.mock('@controller/app/(ecom)/ecom/dashboard/messaging/BulkMessages', () => ({ default: (p: any) => <div data-testid="bulk">bulk balance {p.balance}</div> }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ ECOM_ENRICH_ENDPOINT: '/enrich', ECOM_SCENARIO_ENDPOINT: '/scenario', default: () => null }))
vi.mock('@/components/admin/messaging-templates/TemplateEditor', () => ({
  default: (p: any) => (
    <div data-testid="editor">
      <span>
        editing {p.value.slug || '(new)'}|{p.canResetToPlatform ? 'can-reset' : 'no-reset'}
      </span>
      <button type="button" onClick={() => p.onSave(true)}>
        Publish
      </button>
      <button type="button" onClick={() => p.onSave(false)}>
        Save draft
      </button>
    </div>
  ),
  toEditorTemplate: (t: any) => ({ id: t.id, slug: t.slug, channel: t.channel, name: t.name, subject: '', body: '' }),
}))
vi.mock('@controller/app/(ecom)/ecom/dashboard/_components/PlayDialog', () => ({
  default: ({ target, onClose }: any) => (
    <div data-testid="play">
      play {target.slug}
      <button type="button" onClick={onClose}>
        Close play
      </button>
    </div>
  ),
  PlayButton: ({ onClick }: any) => (
    <span role="button" aria-label="Play" onClick={e => { e.stopPropagation(); onClick() }} />
  ),
}))

import MessagingClient from '@controller/app/(ecom)/ecom/dashboard/messaging/MessagingClient'

const API = '/api/ecom/svc/messaging'
const msg = (over: Record<string, unknown> = {}) => ({ id: 'm1', channel: 'sms', to: '+919876543210', template: 'otp/login', status: 'delivered', price_inr: 0.2, charged_inr: 0.2, error: null, created_at: '2026-11-20T10:00:00Z', ...over })
const tpl = (over: Record<string, unknown> = {}) => ({ id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed', category: 'orders', source: 'platform', ...over })

type Cfg = { messages?: any[]; templates?: any[]; settings?: any; open?: { ok: boolean; body?: any }; save?: { ok: boolean; body: any } }
function mockApi(c: Cfg = {}) {
  const f = vi.fn<(...a: any[]) => any>(async (url: string, init?: any) => {
    const res = (body: any, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body })
    if (url.startsWith(`${API}/messages`)) return res({ items: c.messages ?? [], next_cursor: null })
    if (init?.method === 'PUT' || init?.method === 'POST') return res(c.save?.body ?? { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed' }, c.save?.ok ?? true)
    if (url.startsWith(`${API}/v2/templates?channel=`)) return res({ items: c.templates ?? [tpl()], settings: c.settings })
    if (url.startsWith(`${API}/v2/templates/`)) return res(c.open?.body ?? { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed' }, c.open?.ok ?? true)
    return res({})
  })
  vi.stubGlobal('fetch', f)
  return f
}
const view = () =>
  render(
    <ToastProvider>
      <MessagingClient prices={{ sms: 0.2 }} balance={250} storeName="Acme" />
    </ToastProvider>,
  )

describe('MessagingClient', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/dashboard/messaging')
  })

  it('shows the message log with channel, recipient, status and charge', async () => {
    mockApi({ messages: [msg()] })
    view()
    expect(screen.getByText('Messaging')).toBeInTheDocument()
    expect(await screen.findByText('+919876543210')).toBeInTheDocument()
    expect(screen.getByText('otp/login')).toBeInTheDocument()
    expect(screen.getByText('delivered')).toBeInTheDocument()
    expect(screen.getByText('₹0.20')).toBeInTheDocument()
  })

  it('shows the empty log with a link to create an API key', async () => {
    mockApi({ messages: [] })
    view()
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create an API key' })).toHaveAttribute('href', '/dashboard/api-keys')
  })

  it('the Bulk tab hands the balance to the bulk sender', async () => {
    mockApi()
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Bulk' }))
    expect(screen.getByTestId('bulk')).toHaveTextContent('bulk balance 250')
  })

  it('the Templates tab groups templates by category, labels source and filters', async () => {
    mockApi({ templates: [tpl(), tpl({ id: 't2', slug: 'otp/login', name: 'Login code', category: 'auth', source: 'tenant', review_status: 'pending' })] })
    view()
    await new Promise(r => setTimeout(r, 10))
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    expect(await screen.findByText('Order confirmed')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('Customised')).toBeInTheDocument()
    expect(screen.getByText('in review')).toBeInTheDocument()
    await vi.waitFor(() => expect(location.search).toBe('?tab=templates&channel=email'))
    fireEvent.change(screen.getByPlaceholderText('Filter templates'), { target: { value: 'zzz' } })
    expect(screen.getByText('No templates match')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByText('Order confirmed')).toBeInTheDocument()
  })

  it('switching channel reloads that channel', async () => {
    const f = mockApi()
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    await screen.findByText('Order confirmed')
    fireEvent.click(screen.getByRole('tab', { name: /WhatsApp/ }))
    await vi.waitFor(() => expect(f.mock.calls.some(c => c[0] === `${API}/v2/templates?channel=whatsapp`)).toBe(true))
  })

  it('opens a template into the editor and reflects it in the URL', async () => {
    mockApi()
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    expect(await screen.findByText('Select a template to edit')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Order confirmed'))
    expect(await screen.findByTestId('editor')).toHaveTextContent('editing order/confirmed|can-reset')
    expect(location.search).toContain('template=order%2Fconfirmed')
    expect(screen.getByRole('button', { name: 'Test live' })).toBeInTheDocument()
  })

  it('toasts when a template cannot be opened', async () => {
    mockApi({ open: { ok: false } })
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    fireEvent.click(await screen.findByText('Order confirmed'))
    expect(await screen.findByText('Could not open that template.')).toBeInTheDocument()
  })

  it('creates a new template: needs a slug field and saves with POST', async () => {
    const f = mockApi({ save: { ok: true, body: { id: 'n1', slug: 'new/one', channel: 'email', name: 'New one' } } })
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    await screen.findByText('Order confirmed')
    fireEvent.click(screen.getByRole('button', { name: 'New template' }))
    expect(screen.getByText('Slug (e.g. order/confirmed)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Template published.')).toBeInTheDocument()
    const post = f.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe(`${API}/v2/templates`)
    expect(JSON.parse(post[1].body)).toMatchObject({ channel: 'email', publish: true })
  })

  it('saving an existing template as a draft uses PUT, and a pending review is announced', async () => {
    const f = mockApi({ save: { ok: true, body: { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed', review_status: 'pending' } } })
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    fireEvent.click(await screen.findByText('Order confirmed'))
    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument()
    expect(screen.getByText(/Jeffi will review it/)).toBeInTheDocument()
    expect(f.mock.calls.find(c => c[1]?.method === 'PUT')![0]).toBe(`${API}/v2/templates/t1`)
    expect(await screen.findByText(/In review\./)).toBeInTheDocument()
  })

  it('shows the save error', async () => {
    mockApi({ save: { ok: false, body: { message: 'Slug already taken' } } })
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    fireEvent.click(await screen.findByText('Order confirmed'))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Save failed: Slug already taken')).toBeInTheDocument()
  })

  it('shows a rejected-review banner with the reviewer note', async () => {
    mockApi({ open: { ok: true, body: { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed', review_status: 'rejected', review_note: 'Remove the link' } } })
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    fireEvent.click(await screen.findByText('Order confirmed'))
    expect(await screen.findByText(/Changes not approved\./)).toBeInTheDocument()
    expect(screen.getByText(/Remove the link/)).toBeInTheDocument()
  })

  it('when Jeffi manages the templates, hides New and explains why', async () => {
    mockApi({ settings: { editing_enabled: false, review_required: false } })
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    fireEvent.click(await screen.findByText('Order confirmed'))
    expect(await screen.findByText(/managed by Jeffi/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New template' })).toBeNull()
    expect(screen.getByTestId('editor')).toHaveTextContent('no-reset')
  })

  it('empty template list invites creating the first one', async () => {
    mockApi({ templates: [] })
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    expect(await screen.findByText('No templates yet')).toBeInTheDocument()
    expect(screen.getByText('Create the first one for this channel.')).toBeInTheDocument()
  })

  it('a row play button opens the live test dialog for that template', async () => {
    mockApi()
    view()
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    const row = (await screen.findByText('Order confirmed')).closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Play' }))
    expect(screen.getByTestId('play')).toHaveTextContent('play order/confirmed')
    fireEvent.click(screen.getByRole('button', { name: 'Close play' }))
    expect(screen.queryByTestId('play')).toBeNull()
  })

  it('restores the tab, channel and open template from the URL', async () => {
    history.replaceState(null, '', '/dashboard/messaging?tab=templates&channel=sms&template=otp%2Flogin')
    const f = mockApi({ open: { ok: true, body: { id: 't9', slug: 'otp/login', channel: 'sms', name: 'Login code' } } })
    view()
    expect(await screen.findByTestId('editor')).toHaveTextContent('editing otp/login')
    expect(f.mock.calls.some(c => c[0] === `${API}/v2/templates/sms/otp%2Flogin`)).toBe(true)
  })
})
