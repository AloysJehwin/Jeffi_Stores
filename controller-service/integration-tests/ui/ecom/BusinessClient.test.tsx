import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ id, value, onChange, options, placeholder, disabled }: any) => (
    <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@controller/app/(ecom)/ecom/_ui/phone', () => ({
  PhoneInput: ({ id, value, onChange }: any) => <input id={id} value={value} onChange={e => onChange(e.target.value)} />,
  isValidPhone: (v: string) => /^\+\d{10,}$/.test(v),
}))
vi.mock('@controller/app/(ecom)/ecom/dashboard/business/DocCard', () => ({ default: (p: any) => <div data-testid="doc-card">{p.docType}|{p.blocked ?? 'open'}</div> }))
vi.mock('@controller/app/(ecom)/ecom/dashboard/business/KybChecklist', async importActual => {
  const actual = await importActual<typeof import('@controller/app/(ecom)/ecom/dashboard/business/KybChecklist')>()
  return { ...actual, VerificationChecklist: (p: any) => <div data-testid="checklist">{p.services.join(',')}|showcase={String(p.showcase)}</div> }
})

import { gstinCheckChar } from '@controller/lib/kyb/ids'
import BusinessClient from '@controller/app/(ecom)/ecom/dashboard/business/BusinessClient'

afterEach(() => vi.useRealTimers())

const GSTIN = (() => {
  const first = '29ABCCE1234F1Z'
  return first + gstinCheckChar(first)
})()
const item = (state = 'missing', problem: string | null = null) => ({ state, problem })
const svc = (ready = false, active = true) => ({ ready, verified: false, active, todo: [], required: [], approval: null })
const kybView = (over: Record<string, any> = {}): any => ({
  tenantId: 't1',
  status: null,
  reviewerNote: null,
  profile: {
    legalName: 'Acme Traders Pvt Ltd', tradeName: null, entityType: 'pvt_ltd', addressLine: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', authorizedName: 'Asha Rao',
    authorizedDesignation: 'Director', mobile: '', pan: null, gstRegistered: null, gstin: null, gstExemptReason: null, gstExemptNote: null, website: null, messagingUse: null, ...over.profile,
  },
  locked: [],
  docs: [],
  items: { profile: item('complete'), pan: item(), gst: item(), registration: item('not_needed'), website: item(), messaging_use: item(), bank: item(), licences: item() },
  services: { showcase: svc(false, true), store: svc(false, false), messaging: svc(), documents: svc() },
  ...over.rest,
})
const view = (kyb = kybView(), props: Record<string, unknown> = {}) =>
  render(
    <ToastProvider>
      <BusinessClient initial={kyb} focus={null} slug="acme" hasStore={false} today="2026-11-24" {...(props as any)} />
    </ToastProvider>,
  )
const putOk = (next: any) => {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ kyb: next }) })
  vi.stubGlobal('fetch', f)
  return f
}
const body = (f: any) => JSON.parse(f.mock.calls[0][1].body)

describe('BusinessClient', () => {
  it('shows the reviewer note and a checklist of the API services, the focused one first', () => {
    view(kybView({ rest: { reviewerNote: 'Please add your PAN card', status: 'rejected' } }), { focus: 'documents' })
    expect(screen.getByText(/Please add your PAN card/)).toBeInTheDocument()
    expect(screen.getByTestId('checklist')).toHaveTextContent('documents,messaging|showcase=true')
  })

  it('includes the store in the checklist when the workspace has one', () => {
    view(kybView({ rest: { services: { showcase: svc(), store: svc(false, true), messaging: svc(), documents: svc() } } }))
    expect(screen.getByTestId('checklist')).toHaveTextContent('messaging,documents,store')
  })

  it('prefills the business details and enables Save only once something changes', () => {
    view()
    expect((screen.getByLabelText('Legal name') as HTMLInputElement).value).toBe('Acme Traders Pvt Ltd')
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('1 MG Road')
    const save = screen.getAllByRole('button', { name: 'Save' })[0]
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Mysuru' } })
    expect(save).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('validates required details before any request', () => {
    const f = putOk(kybView())
    view()
    fireEvent.change(screen.getByLabelText('Legal name'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '12ab' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(screen.getByText('Enter the legal name.')).toBeInTheDocument()
    expect(screen.getByText('Enter the 6-digit PIN code.')).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })

  it('saves changed details, then toasts', async () => {
    const f = putOk(kybView({ profile: { city: 'Mysuru' } }))
    view()
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Mysuru' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(await screen.findByText('Business details saved.')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/kyb')
    expect(f.mock.calls[0][1].method).toBe('PUT')
    expect(body(f)).toMatchObject({ legalName: 'Acme Traders Pvt Ltd', city: 'Mysuru' })
  })

  it('shows a field error from the server next to the field', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Validation failed', fields: { legalName: 'Legal name is too short' } }) }))
    view()
    fireEvent.change(screen.getByLabelText('Legal name'), { target: { value: 'Acme Traders Ltd' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(await screen.findByText('Legal name is too short')).toBeInTheDocument()
  })

  it('toasts an error that is not about the saved section', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Service unavailable' }) }))
    view()
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Mysuru' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
  })

  it('a locked field is read-only with the support note', () => {
    view(kybView({ rest: { locked: ['legalName'] } }))
    expect(screen.getByLabelText('Legal name')).toHaveAttribute('readonly')
    expect(screen.getByText('Verified by Jeffi. Contact support to change this.')).toBeInTheDocument()
  })

  it('filling the PIN code picks the state when none is set, and picking a business type sets the usual title', () => {
    view(kybView({ profile: { state: '', pincode: '', entityType: '', authorizedDesignation: '' } }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '560001' } })
    expect((screen.getByLabelText('State') as HTMLSelectElement).value).toBe('Karnataka')
    fireEvent.change(screen.getByLabelText('Business type'), { target: { value: 'pvt_ltd' } })
    expect((screen.getByLabelText(/^Designation/) as HTMLInputElement).value).toBe('Director')
  })

  it('checks the PAN against the business type and saves a valid one', async () => {
    const f = putOk(kybView({ profile: { pan: 'ABCCE1234F' } }))
    view()
    const pan = screen.getByRole('textbox', { name: 'PAN' })
    fireEvent.change(pan, { target: { value: 'abcpe1234f' } })
    expect(screen.getByText(/is the PAN of an individual, not of a private limited company/)).toBeInTheDocument()
    fireEvent.change(pan, { target: { value: 'abcce1234f' } })
    expect(screen.getByText('Issued to a company.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1])
    expect(await screen.findByText('PAN saved.')).toBeInTheDocument()
    expect(body(f)).toEqual({ pan: 'ABCCE1234F' })
  })

  it('does not send an invalid PAN', () => {
    const f = putOk(kybView())
    view()
    fireEvent.change(screen.getByRole('textbox', { name: 'PAN' }), { target: { value: 'ABC' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1])
    expect(screen.getByText(/Enter the PAN as 5 letters/)).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })

  it('blocks the PAN card upload until the name and PAN are saved', () => {
    view(kybView({ profile: { legalName: null } }))
    expect(screen.getByText(/pan_card\|Save your business details first/)).toBeInTheDocument()
  })

  it('GST: asking for a GSTIN that carries the PAN and state, then saving it', async () => {
    const f = putOk(kybView({ profile: { pan: 'ABCCE1234F', gstRegistered: true, gstin: GSTIN } }))
    view(kybView({ profile: { pan: 'ABCCE1234F' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    const gstin = screen.getByLabelText('GSTIN')
    fireEvent.change(gstin, { target: { value: '29ZZZZZ9999Z1ZZ' } })
    expect(screen.getByText(/is not a valid GSTIN|doesn't match/)).toBeInTheDocument()
    fireEvent.change(gstin, { target: { value: GSTIN } })
    expect(screen.getByText('Registered in Karnataka.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[2])
    expect(await screen.findByText('GST details saved.')).toBeInTheDocument()
    expect(body(f)).toEqual({ gstRegistered: true, gstin: GSTIN })
    expect(screen.getAllByTestId('doc-card').some(d => d.textContent?.startsWith('gst_cert'))).toBe(true)
  })

  it('GST: not registered needs a reason and offers a registration proof', async () => {
    const f = putOk(kybView({ profile: { gstRegistered: false, gstExemptReason: 'below_threshold' } }))
    view()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[2])
    expect(screen.getByText('Tell us why the business isn’t registered for GST.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Why isn’t it registered?'), { target: { value: 'below_threshold' } })
    fireEvent.change(screen.getByLabelText(/Anything to add/), { target: { value: '  turnover small ' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[2])
    expect(await screen.findByText('GST details saved.')).toBeInTheDocument()
    expect(body(f)).toEqual({ gstRegistered: false, gstExemptReason: 'below_threshold', gstExemptNote: 'turnover small' })
    expect(screen.getByText('Registration proof')).toBeInTheDocument()
  })

  it('GST: no save button until the owner answers whether the business is registered', () => {
    view()
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(5)
  })

  it('website: offers the store address, then saves the edited address', async () => {
    const f = putOk(kybView({ profile: { website: 'https://acme.in' } }))
    view(kybView(), { hasStore: true })
    fireEvent.click(screen.getByRole('button', { name: /Use your store, acme.jeffistores.in/ }))
    expect((screen.getByLabelText('Website or business page') as HTMLInputElement).value).toBe('https://acme.jeffistores.in')
    fireEvent.change(screen.getByLabelText('Website or business page'), { target: { value: 'https://acme.in' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[2])
    expect(await screen.findByText('Website saved.')).toBeInTheDocument()
    expect(body(f)).toEqual({ website: 'https://acme.in' })
  })

  it('messaging use: every missing answer is flagged before any request', () => {
    const f = putOk(kybView())
    view()
    const dirtyStart = screen.getByLabelText('One message you will send')
    fireEvent.change(dirtyStart, { target: { value: 'hi' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    expect(screen.getByText('Pick what you will send.')).toBeInTheDocument()
    expect(screen.getByText('Pick how many messages you expect to send.')).toBeInTheDocument()
    expect(screen.getByText('Describe how people agree to receive your messages.')).toBeInTheDocument()
    expect(screen.getByText('Add one message you will send.')).toBeInTheDocument()
    expect(screen.getByText('Accept the messaging policy.')).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })

  it('messaging use: saves purposes, volume, opt-in, sample and acceptance', async () => {
    const f = putOk(kybView())
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Sign-in and verification codes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Under 1,000 a month' }))
    fireEvent.change(screen.getByLabelText('How people agree to hear from you'), { target: { value: 'Customers tick a box at checkout' } })
    fireEvent.change(screen.getByLabelText('One message you will send'), { target: { value: 'Your order has shipped' } })
    fireEvent.click(screen.getByLabelText(/I accept Jeffi’s messaging policy/))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    expect(await screen.findByText('Saved how you will message people.')).toBeInTheDocument()
    expect(body(f).messagingUse).toMatchObject({ purposes: ['otp'], volume: 'lt_1k', optIn: 'Customers tick a box at checkout', sample: 'Your order has shipped', accept: true })
  })

  it('refreshes the console when a save changes which services are ready', async () => {
    const next = kybView({ rest: { services: { showcase: svc(), store: svc(false, false), messaging: svc(true), documents: svc() } } })
    putOk(next)
    view()
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Mysuru' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('polls for the result of a document check that is still running', async () => {
    vi.useFakeTimers()
    const pendingDoc = { id: 'd1', docType: 'pan_card', label: 'PAN card', analysisStatus: 'pending' }
    const done = kybView({ rest: { docs: [{ ...pendingDoc, analysisStatus: 'done' }] } })
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ kyb: done }) })
    vi.stubGlobal('fetch', f)
    view(kybView({ rest: { docs: [pendingDoc] } }))
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('/api/ecom/kyb')
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
