import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => sp }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/components/admin/email-composer/EmailComposer', () => ({
  default: ({ value, onChange }: any) => <textarea aria-label="body" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label={options[0].label.startsWith('None — manual') ? 'scenario' : 'coupon'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import NewCampaignClient from '@admin/app/(admin)/admin/campaigns/new/NewCampaignClient'

const scenarios = [{ kind: 'cart', name: 'Cart abandon', description: 'idle carts', trigger: 'a day', default_parameters: {} }]
const coupons = [{ id: 'c1', code: 'SAVE10', discount_type: 'percentage', discount_value: 10, description: 'ten' }]
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown) => ({ ok, json: async () => body })

describe('NewCampaignClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    push.mockReset()
    showToast.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/campaigns/scenarios') return json(true, { scenarios })
      if (url === '/api/admin/campaigns/coupons') return json(true, { coupons })
      return json(true, { kind: 'summer_sale' })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads scenarios and coupons into the selects and keeps Save disabled until name and kind are set', async () => {
    render(asAdmin(<NewCampaignClient />))
    expect(await screen.findByRole('option', { name: 'Cart abandon — idle carts' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'SAVE10 — 10% off (ten)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeDisabled()
  })

  it('normalises the kind slug and live-renders the preview subject and coupon', async () => {
    render(asAdmin(<NewCampaignClient />))
    await screen.findByRole('option', { name: /SAVE10/ })
    fireEvent.change(screen.getByPlaceholderText('e.g. summer_sale'), { target: { value: 'Summer Sale!' } })
    expect(screen.getByPlaceholderText('e.g. summer_sale')).toHaveValue('summer_sale_')
    const subject = document.querySelector('input.pr-8, input[class*="pr-8"]') as HTMLInputElement
    fireEvent.change(subject, { target: { value: 'Use {couponCode}' } })
    expect(screen.getByText('Use BACK-AB12CD')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('coupon'), { target: { value: 'c1' } })
    expect(screen.getByText('Use SAVE10')).toBeInTheDocument()
    expect(screen.getByText(/will be injected as/)).toBeInTheDocument()
  })

  it('preselects the scenario from the query string', async () => {
    sp = new URLSearchParams('scenario=cart')
    render(asAdmin(<NewCampaignClient />))
    await waitFor(() => expect(screen.getByLabelText('scenario')).toHaveValue('cart'))
  })

  it('creates the campaign with the form body and navigates to it', async () => {
    render(asAdmin(<NewCampaignClient />))
    await screen.findByRole('option', { name: /SAVE10/ })
    fireEvent.change(screen.getByPlaceholderText('e.g. Summer Sale'), { target: { value: 'Summer Sale' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. summer_sale'), { target: { value: 'summer_sale' } })
    fireEvent.change(screen.getByLabelText('scenario'), { target: { value: 'cart' } })
    fireEvent.change(screen.getByLabelText('coupon'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByLabelText('body'), { target: { value: '<p>Hi</p>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns/summer_sale')))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('/api/admin/campaigns')
    expect(JSON.parse(post[1].body)).toMatchObject({ name: 'Summer Sale', kind: 'summer_sale', scenario_kind: 'cart', coupon_id: 'c1', body_template: '<p>Hi</p>' })
    expect(showToast).toHaveBeenCalledWith('Campaign created', 'success')
  })

  it('toasts the server error when creation fails and stays on the page', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      init?.method === 'POST' ? json(false, { error: 'Kind already exists' }) : json(true, url.endsWith('coupons') ? { coupons } : { scenarios }))
    render(asAdmin(<NewCampaignClient />))
    await screen.findByRole('option', { name: /SAVE10/ })
    fireEvent.change(screen.getByPlaceholderText('e.g. Summer Sale'), { target: { value: 'X' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. summer_sale'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Kind already exists', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('AI generate fills empty name, kind, subject and body from the response', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      url === '/api/admin/campaigns/generate'
        ? json(true, { name: 'Flash', kind: 'flash', subject_template: 'Flash!', body_template: '<b>x</b>' })
        : json(true, url.endsWith('coupons') ? { coupons } : { scenarios }))
    render(asAdmin(<NewCampaignClient />))
    await screen.findByRole('option', { name: /SAVE10/ })
    fireEvent.change(screen.getByPlaceholderText('Describe the campaign email you want…'), { target: { value: 'flash sale' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Template generated', 'success'))
    expect(screen.getByPlaceholderText('e.g. Summer Sale')).toHaveValue('Flash')
    expect(screen.getByPlaceholderText('e.g. summer_sale')).toHaveValue('flash')
    expect(screen.getByLabelText('body')).toHaveValue('<b>x</b>')
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/admin/campaigns/generate')!
    expect(JSON.parse(call[1].body)).toMatchObject({ prompt: 'flash sale', scenarioKind: null })
  })

  it('shows the AI error from the server', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/admin/campaigns/generate' ? json(false, { error: 'Quota hit' }) : json(true, url.endsWith('coupons') ? { coupons } : { scenarios }))
    render(asAdmin(<NewCampaignClient />))
    fireEvent.change(screen.getByPlaceholderText('Describe the campaign email you want…'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Quota hit')).toBeInTheDocument()
  })

  it('hides the AI box and save button without write access', async () => {
    render(asMember(<NewCampaignClient />, ['campaigns:read']))
    await screen.findByRole('option', { name: /SAVE10/ })
    expect(screen.queryByText('Generate template with AI')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).not.toBeInTheDocument()
  })
})
