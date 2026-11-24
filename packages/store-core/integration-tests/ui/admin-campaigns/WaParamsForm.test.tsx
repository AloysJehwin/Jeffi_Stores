import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/admin/ImageUrlInput', () => ({
  default: ({ value, onChange, placeholder }: any) => <input aria-label="media" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ fieldLabel }: any) => <span>{`ai:${fieldLabel}`}</span> }))

import WaParamsForm, { waParams, usageContext, VarInput, InsertVariable } from '@/components/admin/campaigns/WaParamsForm'

const body = 'Hi {{1}}, your order {{2}} is ready. Track it here.'
const blocks = {
  variables: { '1': 'Priya', '2': 'A100', '3': 'hero.jpg', '4': 'orders/1' },
  types: { 'twilio/media': { media: ['https://cdn.shop/{{3}}'] } },
  buttons: [{ type: 'url', label: 'Track', value: 'https://shop.in/{{4}}' }],
}

describe('waParams', () => {
  it('extracts body slots with context, samples, header media and the url button', () => {
    const p = waParams(body, blocks)
    expect(p.body.map(b => b.n)).toEqual(['1', '2'])
    expect(p.body[0].sample).toBe('Priya')
    expect(p.body[0].context).toContain('▢')
    expect(p.media).toEqual({ slot: '3', prefix: 'https://cdn.shop/', sample: 'hero.jpg' })
    expect(p.button).toEqual({ slot: '4', prefix: 'https://shop.in/', label: 'Track' })
  })

  it('returns no media or button for a plain template', () => {
    const p = waParams('Hello {{1}}', null)
    expect(p.media).toBeNull()
    expect(p.button).toBeNull()
  })
})

describe('usageContext', () => {
  it('shows text around the first match, stripping HTML', () => {
    expect(usageContext('name', '<p>Hello {name}, welcome</p>')).toBe(' Hello ▢, welcome ')
    expect(usageContext('name', null, 'nothing here')).toBeNull()
  })
})

describe('WaParamsForm', () => {
  const baseProps = { vars: {}, setVars: vi.fn(), mediaUrl: '', setMediaUrl: vi.fn(), linkUrl: '', setLinkUrl: vi.fn(), inputClass: 'inp' }

  it('renders nothing for a template with no parameters', () => {
    const { container } = render(<WaParamsForm {...baseProps} params={waParams('Hello', null)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a field per body slot, the header image and the button link', () => {
    const setVars = vi.fn()
    const setMediaUrl = vi.fn()
    const setLinkUrl = vi.fn()
    render(<WaParamsForm {...baseProps} params={waParams(body, blocks)} setVars={setVars} setMediaUrl={setMediaUrl} setLinkUrl={setLinkUrl} />)
    expect(screen.getByText(/WhatsApp — fill in the template/)).toBeInTheDocument()
    expect(screen.getByText('Text 2')).toBeInTheDocument()
    expect(screen.getByText('ai:WhatsApp slot {{1}}')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. Priya'), { target: { value: 'Asha' } })
    expect(setVars).toHaveBeenCalled()
    expect(setVars.mock.calls[0][0]({ x: '1' })).toEqual({ x: '1', '1': 'Asha' })
    fireEvent.change(screen.getByLabelText('media'), { target: { value: ' https://cdn.shop/a.jpg ' } })
    expect(setMediaUrl).toHaveBeenCalledWith('https://cdn.shop/a.jpg')
    expect(screen.getByText(/“Track” button link/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('https://your-store/products/…'), { target: { value: 'https://shop.in/x' } })
    expect(setLinkUrl).toHaveBeenCalledWith('https://shop.in/x')
  })

  it('flags an image outside the approved prefix', () => {
    render(<WaParamsForm {...baseProps} params={waParams(body, blocks)} mediaUrl="https://evil.com/x.jpg" />)
    expect(screen.getByText(/only accepts images under https:\/\/cdn\.shop\//)).toBeInTheDocument()
  })
})

describe('VarInput and InsertVariable', () => {
  it('inserts a variable token into the value from the menu', () => {
    const onChange = vi.fn()
    render(<VarInput value="Hi " onChange={onChange} className="inp" placeholder="Type" />)
    fireEvent.click(screen.getByTitle('Insert variable'))
    fireEvent.click(screen.getByText('First name'))
    expect(onChange).toHaveBeenCalledWith('Hi {firstName}')
  })

  it('renders a textarea with rows, and closes the menu on outside click', () => {
    render(<VarInput value="" onChange={vi.fn()} className="inp" rows={3} />)
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA')
    fireEvent.click(screen.getByTitle('Insert variable'))
    expect(screen.getByText('Coupon code')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Coupon code')).not.toBeInTheDocument()
  })

  it('InsertVariable shows a text label when not compact', () => {
    const onInsert = vi.fn()
    render(<InsertVariable onInsert={onInsert} />)
    fireEvent.click(screen.getByRole('button', { name: /Insert variable/ }))
    fireEvent.click(screen.getByText('Discount %'))
    expect(onInsert).toHaveBeenCalledWith('{discountPercent}')
  })
})
