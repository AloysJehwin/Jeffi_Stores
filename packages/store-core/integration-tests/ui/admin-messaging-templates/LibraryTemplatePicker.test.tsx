import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
vi.mock('@/contexts/AdminHostContext', () => ({ useAdminHost: () => null }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="template" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import LibraryTemplatePicker from '@/components/admin/messaging-templates/LibraryTemplatePicker'

const list = {
  items: [
    { id: '1', slug: 'abandoned_cart', name: 'Cart reminder', category: 'cart', channel: 'whatsapp', approval_status: 'approved', source: 'tenant' },
    { id: '2', slug: 'promo_offer', name: 'Promo offer', category: 'promo', channel: 'whatsapp', approval_status: 'pending' },
    { id: '3', slug: 'draft_tpl', name: 'Draft one', category: 'other', channel: 'whatsapp', approval_status: 'rejected' },
  ],
}
const detail = {
  id: '1',
  slug: 'abandoned_cart',
  name: 'Cart reminder',
  channel: 'whatsapp',
  approval_status: 'approved',
  current_version: { subject: null, body: 'Hi <b>{{1}}</b>, your cart waits', variables: ['1', 'couponCode'], blocks: null },
}

describe('LibraryTemplatePicker', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>(async (url: string) => {
      if (url.includes('/whatsapp/abandoned_cart')) return { ok: true, json: async () => detail }
      return { ok: true, json: async () => list }
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows a skeleton, then options with customised and Meta-approval states', async () => {
    const { container } = render(<LibraryTemplatePicker channel="whatsapp" value={null} onChange={() => {}} noneLabel="Built-in message" />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Built-in message' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Cart reminder · customised' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Promo offer' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Draft one' })).toBeDisabled()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/messaging-templates?channel=whatsapp')
  })

  it('reports the chosen slug, and null for the none option', async () => {
    const onChange = vi.fn()
    render(<LibraryTemplatePicker channel="whatsapp" value={null} onChange={onChange} kind="abandoned_cart" />)
    const select = await screen.findByLabelText('template')
    fireEvent.change(select, { target: { value: 'abandoned_cart' } })
    expect(onChange).toHaveBeenCalledWith('abandoned_cart')
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('loads the picked template, shows its text and the edit link, and warns about unfilled variables', async () => {
    const onLoaded = vi.fn()
    render(<LibraryTemplatePicker channel="whatsapp" value="abandoned_cart" onChange={() => {}} supplied={['firstName']} onLoaded={onLoaded} />)
    expect(await screen.findByText(/Hi \{\{1\}\} , your cart waits/)).toBeInTheDocument()
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ slug: 'abandoned_cart', body: expect.any(String) })))
    expect(screen.getByRole('link', { name: /Edit in Templates/ }).getAttribute('href')).toContain('channel=whatsapp&slug=abandoned_cart')
    expect(screen.getByText(/doesn't provide \{\{couponCode\}\}/)).toBeInTheDocument()
  })

  it('falls back to an empty list when the library fails to load', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<LibraryTemplatePicker channel="sms" value={null} onChange={() => {}} />)
    expect(await screen.findByRole('option', { name: 'No SMS template' })).toBeInTheDocument()
  })
})
