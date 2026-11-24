import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin } from '../_support'

const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/admin/marketing/messaging-templates',
  useSearchParams: () => sp,
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
let channels = { sms: true, whatsapp: true, push: false }
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => channels }))
vi.mock('@/components/admin/messaging-templates/TemplateEditor', () => ({
  toEditorTemplate: (t: any) => ({ ...t }),
  default: (p: any) => (
    <div>
      <p>editor:{p.value.channel}:{p.value.slug}:{p.value.name}:{p.value.blocks_format}</p>
      <p>platform:{String(p.isPlatformLibrary)}:reset:{String(p.canResetToPlatform)}:meta:{String(p.metaActions)}</p>
      <button onClick={() => p.onChange({ ...p.value, name: 'Edited' })}>edit-name</button>
      <button onClick={() => p.onSave(false)}>save-draft</button>
      <button onClick={() => p.onSave(true)}>save-publish</button>
      <button onClick={p.onCancel}>close-editor</button>
    </div>
  ),
}))

import MessagingTemplatesClient from '@admin/app/(admin)/admin/marketing/messaging-templates/MessagingTemplatesClient'

const items = [
  { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed', category: 'orders', source: 'tenant' },
  { id: 't2', slug: 'order/shipped', channel: 'email', name: 'Order shipped', category: 'orders', source: 'platform' },
  { id: 't3', slug: 'welcome', channel: 'email', name: '', category: null, source: 'platform' },
]
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()

describe('MessagingTemplatesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sp = new URLSearchParams()
    channels = { sms: true, whatsapp: true, push: false }
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/messaging-templates?channel=')) return json(true, { items })
      return json(true, { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed', subject: 's', body: 'b' })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists templates grouped by category with Customised / Standard badges and counts', async () => {
    render(asAdmin(<MessagingTemplatesClient />))
    expect(await screen.findByText('Order confirmed')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/messaging-templates?channel=email')
    expect(screen.getByText('orders')).toBeInTheDocument()
    expect(screen.getByText('uncategorised')).toBeInTheDocument()
    expect(screen.getByText('Customised')).toBeInTheDocument()
    expect(screen.getAllByText('Standard').length).toBe(2)
    expect(screen.getByText('1 customised · 2 standard')).toBeInTheDocument()
    expect(screen.getByText('order/shipped')).toBeInTheDocument()
    expect(screen.getByText('Select a template to edit')).toBeInTheDocument()
  })

  it('shows only the email tab when SMS and WhatsApp are switched off', async () => {
    channels = { sms: false, whatsapp: false, push: false }
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    expect(screen.getByRole('tab', { name: /Email/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /SMS/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /WhatsApp/ })).not.toBeInTheDocument()
  })

  it('falls back to email for a ?channel= whose switch is off', async () => {
    channels = { sms: false, whatsapp: false, push: false }
    sp = new URLSearchParams('channel=sms')
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/messaging-templates?channel=email')
  })

  it('switching channel updates the URL and reloads that channel', async () => {
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    fireEvent.click(screen.getByRole('tab', { name: /SMS/ }))
    expect(replace).toHaveBeenCalledWith('?channel=sms', { scroll: false })
  })

  it('loads the channel from the URL', async () => {
    sp = new URLSearchParams('channel=whatsapp')
    render(asAdmin(<MessagingTemplatesClient />))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/messaging-templates?channel=whatsapp'))
  })

  it('filters by name, slug or category and shows the empty state', async () => {
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    const filter = screen.getByPlaceholderText('Filter by name, slug, or category')
    fireEvent.change(filter, { target: { value: 'shipped' } })
    expect(screen.queryByText('Order confirmed')).not.toBeInTheDocument()
    expect(screen.getByText('Order shipped')).toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith('?q=shipped', { scroll: false })
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(screen.getByText('No templates match')).toBeInTheDocument()
    expect(screen.getByText('Try a different filter.')).toBeInTheDocument()
  })

  it('shows the create hint when there are no templates at all', async () => {
    fetchMock.mockResolvedValue(json(true, { items: [] }))
    render(asAdmin(<MessagingTemplatesClient />))
    expect(await screen.findByText('No templates match')).toBeInTheDocument()
    expect(screen.getByText(/Create one with/)).toBeInTheDocument()
  })

  it('clicking a template puts its slug in the URL', async () => {
    render(asAdmin(<MessagingTemplatesClient />))
    fireEvent.click(await screen.findByText('Order shipped'))
    expect(replace).toHaveBeenCalledWith('?slug=order%2Fshipped', { scroll: false })
  })

  it('opens the template named by ?slug= from the API', async () => {
    sp = new URLSearchParams('slug=order/confirmed')
    render(asAdmin(<MessagingTemplatesClient />))
    expect(await screen.findByText(/^editor:email:order\/confirmed:Order confirmed:/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/messaging-templates/email/order%2Fconfirmed')
    expect(screen.getByText('platform:false:reset:true:meta:true')).toBeInTheDocument()
  })

  it('New template starts a blank draft with the channel format and a slug field', async () => {
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    fireEvent.click(screen.getByRole('button', { name: /New template/ }))
    expect(screen.getByText('editor:email:::tiptap')).toBeInTheDocument()
    expect(screen.getByText('New template', { selector: 'div' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. order/confirmed'), { target: { value: 'my/slug' } })
    expect(screen.getByText('editor:email:my/slug::tiptap')).toBeInTheDocument()
    expect(screen.getByText('platform:true:reset:false:meta:true')).toBeInTheDocument()
  })

  it('uses the SMS text format for a new SMS template', async () => {
    sp = new URLSearchParams('channel=sms')
    render(asAdmin(<MessagingTemplatesClient />))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /New template/ }))
    expect(screen.getByText('editor:sms:::sms-text')).toBeInTheDocument()
  })

  it('saving a new template POSTs it and toasts the draft save', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return json(true, { id: 'new1', slug: 'my/slug', channel: 'email', name: '' })
      return json(true, { items })
    })
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    fireEvent.click(screen.getByRole('button', { name: /New template/ }))
    fireEvent.change(screen.getByPlaceholderText('e.g. order/confirmed'), { target: { value: 'my/slug' } })
    fireEvent.click(screen.getByRole('button', { name: 'save-draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Draft saved.', 'success'))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(url).toBe('/api/admin/messaging-templates')
    expect(JSON.parse(init.body)).toMatchObject({ slug: 'my/slug', channel: 'email', publish: false })
    expect(replace).toHaveBeenCalledWith('?slug=my%2Fslug', { scroll: false })
  })

  it('saving an existing template PUTs to its id and says published', async () => {
    sp = new URLSearchParams('slug=order/confirmed')
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'PUT') return json(true, { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Edited' })
      if (url.startsWith('/api/admin/messaging-templates?')) return json(true, { items })
      return json(true, { id: 't1', slug: 'order/confirmed', channel: 'email', name: 'Order confirmed' })
    })
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText(/editor:email:order\/confirmed/)
    fireEvent.click(screen.getByRole('button', { name: 'save-publish' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Template published.', 'success'))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(url).toBe('/api/admin/messaging-templates/t1')
    expect(JSON.parse(init.body).publish).toBe(true)
  })

  it('toasts the API message when a save fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return json(false, { message: 'Slug taken' }, 409)
      return json(true, { items })
    })
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    fireEvent.click(screen.getByRole('button', { name: /New template/ }))
    fireEvent.click(screen.getByRole('button', { name: 'save-draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Save failed: Slug taken', 'error'))
  })

  it('closing the editor clears the slug and returns to the placeholder', async () => {
    render(asAdmin(<MessagingTemplatesClient />))
    await screen.findByText('Order confirmed')
    fireEvent.click(screen.getByRole('button', { name: /New template/ }))
    fireEvent.click(screen.getByRole('button', { name: 'close-editor' }))
    expect(screen.getByText('Select a template to edit')).toBeInTheDocument()
  })
})
