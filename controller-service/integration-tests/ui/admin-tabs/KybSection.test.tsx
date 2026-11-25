import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/tabs/ComplianceDocRow', () => ({
  default: (p: any) => (
    <li data-testid="doc">
      {p.name}|{p.pending ? 'pending' : 'decided'}|{p.lapsed ? 'lapsed' : 'live'}|{p.href}
      {p.badge}
      {p.detail}
    </li>
  ),
}))
vi.mock('@controller/components/admin/ecom/tabs/KybRecheckButton', () => ({ default: (p: any) => <div data-testid="recheck">checking={p.checking}</div> }))
vi.mock('@controller/components/admin/ecom/tabs/DocCheck', async importActual => {
  const actual = await importActual<typeof import('@controller/components/admin/ecom/tabs/DocCheck')>()
  return { ...actual, default: () => <span data-testid="doccheck" /> }
})

import KybSection, { readinessOf } from '@controller/components/admin/ecom/tabs/KybSection'

const svc = (over: Record<string, unknown> = {}) => ({ required: [], todo: [], ready: true, verified: false, active: false, approval: null, ...over })
const item = (state: string, problem: string | null = null) => ({ state, problem })
const kyb = (over: Record<string, any> = {}): any => ({
  tenantId: 't1',
  status: 'pending',
  reviewerNote: null,
  profile: {
    legalName: 'Acme Traders Pvt Ltd', tradeName: 'Acme', entityType: 'pvt_ltd', addressLine: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001',
    authorizedName: 'Asha Rao', authorizedDesignation: 'Director', mobile: '9876543210', pan: 'ABCCE1234F', gstRegistered: true, gstin: '29ABCDE1234F1Z5',
    gstExemptReason: null, gstExemptNote: null, website: 'https://acme.in', messagingUse: null,
  },
  locked: [],
  docs: [],
  items: {
    profile: item('complete'), pan: item('missing', 'PAN not given'), gst: item('complete'), registration: item('not_needed'), website: item('complete'),
    messaging_use: item('review'), bank: item('complete'), licences: item('complete'),
  },
  services: {
    showcase: svc(),
    store: svc({ active: true, required: ['profile', 'pan', 'bank'], todo: ['pan'], ready: false }),
    messaging: svc({ active: true, approval: 'pending', required: ['profile', 'messaging_use'], todo: [], ready: true }),
    documents: svc(),
  },
  ...over,
})
const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', docType: 'pan_card', label: 'PAN card', number: 'ABCCE1234F', expiresOn: null, uploadedAt: '2026-11-01T00:00:00Z', status: 'pending', reviewNote: null, ownerNote: null, analysisStatus: null, analysis: null, current: true, ...over,
})

describe('readinessOf', () => {
  it('merges the to-do items across services with their problems', () => {
    expect(readinessOf(kyb(), ['store', 'messaging'])).toEqual({ ready: false, verified: false, todo: [{ label: 'PAN', problem: 'PAN not given' }] })
  })
  it('is undefined for services it has no data on', () => {
    expect(readinessOf(kyb(), [])).toBeUndefined()
  })
})

describe('KybSection', () => {
  it('lists the active services with their to-do count and approval wording', () => {
    render(<KybSection tenantId="t1" kyb={kyb()} files={{}} storeRequest={false} />)
    expect(screen.getByText('Business verification (KYB)')).toBeInTheDocument()
    expect(screen.getByText('Online store')).toBeInTheDocument()
    expect(screen.getByText('1 to do')).toBeInTheDocument()
    expect(screen.getByText('KYC waiting for review')).toBeInTheDocument()
    expect(screen.getByText('To do: PAN')).toBeInTheDocument()
    expect(screen.getByText('Messaging API')).toBeInTheDocument()
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.queryByText('Documents API')).toBeNull()
  })

  it('builds a checklist of the items the shown services need, with the problem text', () => {
    render(<KybSection tenantId="t1" kyb={kyb()} files={{}} storeRequest={false} />)
    expect(screen.getByText('PAN not given')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('Waiting for review')).toBeInTheDocument()
    expect(screen.queryByText('Registration proof')).toBeNull()
  })

  it('says a showcase site needs nothing verified when no service is active', () => {
    const k = kyb({ services: { showcase: svc(), store: svc(), messaging: svc(), documents: svc() } })
    render(<KybSection tenantId="t1" kyb={k} files={{}} storeRequest={false} />)
    expect(screen.getByText('A showcase site needs nothing verified.')).toBeInTheDocument()
  })

  it('shows the store when an API workspace has applied for one', () => {
    const k = kyb({ services: { showcase: svc(), store: svc(), messaging: svc({ active: true }), documents: svc() } })
    render(<KybSection tenantId="t1" kyb={k} files={{}} storeRequest />)
    expect(screen.getByText('Online store')).toBeInTheDocument()
  })

  it('shows the business answers: legal name, entity, PAN holder, GST and address', () => {
    render(<KybSection tenantId="t1" kyb={kyb()} files={{}} storeRequest={false} />)
    expect(screen.getByText('Acme Traders Pvt Ltd')).toBeInTheDocument()
    expect(screen.getByText('Private limited company')).toBeInTheDocument()
    expect(screen.getByText('ABCCE1234F')).toBeInTheDocument()
    expect(screen.getByText('Issued to a company')).toBeInTheDocument()
    expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao, Director')).toBeInTheDocument()
    expect(screen.getByText('1 MG Road, Bengaluru, Karnataka 560001')).toBeInTheDocument()
  })

  it('explains an unregistered GST status and links only http(s) websites', () => {
    const k = kyb()
    k.profile = { ...k.profile, gstRegistered: false, gstin: null, gstExemptReason: 'below_threshold', website: 'javascript:alert(1)' }
    render(<KybSection tenantId="t1" kyb={k} files={{}} storeRequest={false} />)
    expect(screen.getByText(/Not registered: turnover below the GST threshold/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull()
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
  })

  it('links a normal website', () => {
    render(<KybSection tenantId="t1" kyb={kyb()} files={{}} storeRequest={false} />)
    expect(screen.getByRole('link', { name: 'https://acme.in' })).toHaveAttribute('href', 'https://acme.in')
  })

  it('shows the messaging use answers and policy acceptance', () => {
    const k = kyb()
    k.profile.messagingUse = { purposes: ['otp', 'marketing'], volume: 'lt_1k', optIn: 'Checkbox at checkout', sample: 'Your order shipped', policyVersion: 3, acceptedAt: '2026-11-05T00:00:00Z' }
    render(<KybSection tenantId="t1" kyb={k} files={{}} storeRequest={false} />)
    expect(screen.getByText(/Sign-in and verification codes, Offers and promotions/)).toBeInTheDocument()
    expect(screen.getByText(/Under 1,000 a month/)).toBeInTheDocument()
    expect(screen.getByText('Checkbox at checkout')).toBeInTheDocument()
    expect(screen.getByText(/Accepted the messaging policy \(version 3\)/)).toBeInTheDocument()
  })

  it('says no documents when none are uploaded', () => {
    render(<KybSection tenantId="t1" kyb={kyb()} files={{}} storeRequest={false} />)
    expect(screen.getByText('No KYB documents uploaded yet.')).toBeInTheDocument()
  })

  it('lists documents in a stable order with the review link, flagging expired ones', () => {
    const k = kyb({ docs: [doc({ id: 'd2', docType: 'zzz_other', label: 'Other', expiresOn: '2020-01-01' }), doc()] })
    render(<KybSection tenantId="t1" kyb={k} files={{}} storeRequest={false} />)
    const rows = screen.getAllByTestId('doc')
    expect(rows[0]).toHaveTextContent('PAN card|pending|live|/api/admin/ecom/kyc/t1/doc/d1')
    expect(rows[1]).toHaveTextContent('Other|pending|lapsed')
    expect(rows[1]).toHaveTextContent('expired')
  })

  it('counts the documents still being checked for the recheck button', () => {
    const files = { a: { analysisStatus: 'pending' }, b: { analysisStatus: 'pending' }, c: { analysisStatus: 'done' } } as any
    render(<KybSection tenantId="t1" kyb={kyb()} files={files} storeRequest={false} />)
    expect(screen.getByTestId('recheck')).toHaveTextContent('checking=2')
  })
})
