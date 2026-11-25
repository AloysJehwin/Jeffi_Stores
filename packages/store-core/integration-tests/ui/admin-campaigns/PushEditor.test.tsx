import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/admin/ImageUrlInput', () => ({
  default: ({ value, onChange }: any) => <input aria-label="image" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ fieldLabel }: any) => <i>{`ai:${fieldLabel}`}</i> }))

import { PushPreview, PushLinkField, PushFields } from '@/components/admin/campaigns/PushEditor'

describe('PushPreview', () => {
  it('fills variables into the collapsed and expanded cards', () => {
    render(<PushPreview title="Hi {firstName}" body="Your code is {couponCode}" vars={{ firstName: 'Priya', couponCode: 'SAVE10' }} brand="Halo" />)
    expect(screen.getAllByText('Hi Priya')).toHaveLength(2)
    expect(screen.getAllByText('Your code is SAVE10')).toHaveLength(2)
    expect(screen.getAllByText('Halo')).toHaveLength(2)
  })

  it('shows placeholders when empty and only https images', () => {
    const { container, rerender } = render(<PushPreview title="" body="" image="javascript:x" />)
    expect(screen.getAllByText('Notification title')).toHaveLength(2)
    expect(screen.getAllByText('The message text shows here.')).toHaveLength(2)
    expect(container.querySelector('img')).toBeNull()
    rerender(<PushPreview title="" body="" image="https://cdn/x.png" />)
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })
})

describe('PushLinkField', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('picks a quick page and flags an invalid path', () => {
    const onChange = vi.fn()
    const { rerender } = render(<PushLinkField value="" onChange={onChange} inputClass="inp" />)
    fireEvent.click(screen.getByRole('button', { name: 'Cart' }))
    expect(onChange).toHaveBeenCalledWith('/cart')
    rerender(<PushLinkField value="https://evil.com" onChange={onChange} inputClass="inp" />)
    expect(screen.getByText(/Use a store path that starts with a single/)).toBeInTheDocument()
  })

  it('searches targets and applies the chosen path', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ kind: 'product', label: 'Cordless drill', path: '/products/drill', image_url: null }] }) })
    const onChange = vi.fn()
    render(<PushLinkField value="" onChange={onChange} inputClass="inp" allowEmpty="/products/x" />)
    expect(screen.getByPlaceholderText('Default: /products/x')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Find a product, category or offer'), { target: { value: 'dri' } })
    fireEvent.click(await screen.findByText('Cordless drill', undefined, { timeout: 2000 }))
    expect(onChange).toHaveBeenCalledWith('/products/drill')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/mailer/link-targets?q=dri')
  })

  it('does not search below two characters', async () => {
    render(<PushLinkField value="" onChange={vi.fn()} inputClass="inp" />)
    fireEvent.change(screen.getByPlaceholderText('Find a product, category or offer'), { target: { value: 'd' } })
    await new Promise(r => setTimeout(r, 350))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PushFields', () => {
  const value = { title: 'Sale', body: 'Big sale today', image_url: 'http://insecure/x.png', link: '/cart' } as never

  it('shows counters, the https warning and the AI helpers', () => {
    render(<PushFields value={value} onChange={vi.fn()} inputClass="inp" labelClass="lbl" context="Diwali" />)
    expect(screen.getByText('App push')).toBeInTheDocument()
    expect(screen.getByText(/^4\/\d+$/)).toBeInTheDocument()
    expect(screen.getByText('Android shows only https:// images.')).toBeInTheDocument()
    expect(screen.getByText('ai:Push title')).toBeInTheDocument()
    expect(screen.getByText('ai:Push text')).toBeInTheDocument()
  })

  it('edits each field through onChange', async () => {
    const onChange = vi.fn()
    render(<PushFields value={value} onChange={onChange} inputClass="inp" labelClass="lbl" />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Diwali sale is live'), { target: { value: 'New title' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...(value as object), title: 'New title' })
    fireEvent.change(screen.getByLabelText('image'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ image_url: undefined }))
    fireEvent.click(screen.getByRole('button', { name: 'Offers' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ link: '/products?onSale=true' }))
  })

  it('hides the image field for scenarios', () => {
    render(<PushFields value={value} onChange={vi.fn()} inputClass="inp" labelClass="lbl" image={false} linkDefault="/products/p" />)
    expect(screen.queryByLabelText('image')).not.toBeInTheDocument()
    waitFor(() => expect(screen.getByPlaceholderText('Default: /products/p')).toBeInTheDocument())
  })
})
