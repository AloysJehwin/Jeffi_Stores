import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const tplBody = 'Hello {{1}}, use code {{2}} today'
vi.mock('@/components/admin/messaging-templates/LibraryTemplatePicker', () => ({
  default: ({ value, onChange, onLoaded, noneLabel }: any) => (
    <div>
      <span>{noneLabel}</span>
      <button onClick={() => onChange('promo/offer')}>choose-promo</button>
      <button onClick={() => onLoaded({ slug: value, body: tplBody, blocks: { variables: { '1': 'Priya' } } })}>load-tpl</button>
    </div>
  ),
}))
vi.mock('@/components/admin/messaging-templates/PhonePreview', () => ({
  default: ({ body, vars, headerMedia }: any) => <div data-testid="phone" data-media={headerMedia ?? ''}>{`${body}|${JSON.stringify(vars)}`}</div>,
}))

import WhatsAppTemplateEditor, { WhatsAppPreview, waSlots } from '@/components/admin/campaigns/WhatsAppTemplateEditor'

describe('waSlots', () => {
  it('returns unique numbered slots in order', () => {
    expect(waSlots('{{2}} and {{1}} and {{2}}')).toEqual(['1', '2'])
    expect(waSlots('')).toEqual([])
  })
})

describe('WhatsAppTemplateEditor', () => {
  it('seeds slot defaults when a template is chosen', () => {
    const onChange = vi.fn()
    render(<WhatsAppTemplateEditor kind="abandoned_cart" value={{ slug: null, variables: {} }} onChange={onChange} />)
    expect(screen.getByText('Built-in WhatsApp message for this campaign')).toBeInTheDocument()
    fireEvent.click(screen.getByText('choose-promo'))
    expect(onChange).toHaveBeenCalledWith({ slug: 'promo/offer', variables: { '1': '{headline}', '2': '{couponCode}', '3': '{discountPercent}' } })
  })

  it('shows a labelled input per slot, edits it, and warns until all are filled', () => {
    const onChange = vi.fn()
    render(<WhatsAppTemplateEditor kind="abandoned_cart" value={{ slug: 'promo/offer', variables: { '1': 'x' } }} onChange={onChange} />)
    fireEvent.click(screen.getByText('load-tpl'))
    expect(screen.getByText('({{1}})')).toBeInTheDocument()
    expect(screen.getByText(/use code/)).toBeInTheDocument()
    expect(screen.getByText(/Fill every slot/)).toBeInTheDocument()
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[1], { target: { value: 'SAVE10' } })
    expect(onChange).toHaveBeenCalledWith({ slug: 'promo/offer', variables: { '1': 'x', '2': 'SAVE10' } })
    fireEvent.click(screen.getAllByRole('button', { name: /use it/ })[1])
    expect(onChange).toHaveBeenLastCalledWith({ slug: 'promo/offer', variables: { '1': 'x', '2': '{couponCode}' } })
  })

  it('asks for confirmation after a template migration', () => {
    const onReviewed = vi.fn()
    render(<WhatsAppTemplateEditor kind="abandoned_cart" value={{ slug: 'promo/offer', variables: {} }} onChange={vi.fn()} needsReview onReviewed={onReviewed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(onReviewed).toHaveBeenCalled()
  })
})

describe('WhatsAppPreview', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('prompts for a template when none is selected', () => {
    render(<WhatsAppPreview value={{ slug: null, variables: {} }} vars={{}} />)
    expect(screen.getByText('Select a WhatsApp template to preview the message.')).toBeInTheDocument()
  })

  it('fills slots with sample variables in the phone preview', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ current_version: { body: tplBody, blocks: { types: { 'twilio/media': { media: ['https://img/{{3}}.png'] } }, variables: { '3': 'hero' } } } }),
    })
    render(<WhatsAppPreview value={{ slug: 'promo/offer', variables: { '1': '{firstName}', '2': 'SAVE10' } }} vars={{ firstName: 'Priya' }} />)
    const phone = await screen.findByTestId('phone')
    expect(phone).toHaveTextContent('{"1":"Priya","2":"SAVE10"}')
    expect(phone.dataset.media).toBe('https://img/hero.png')
    await waitFor(() => expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/messaging-templates/whatsapp/promo%2Foffer'))
  })

  it('keeps the prompt when the template cannot be loaded', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<WhatsAppPreview value={{ slug: 'gone', variables: {} }} vars={{}} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText(/Select a WhatsApp template/)).toBeInTheDocument()
  })
})
