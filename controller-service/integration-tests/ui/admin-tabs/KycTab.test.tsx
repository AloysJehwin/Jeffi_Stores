import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/tabs/KycActionButtons', () => ({
  default: (p: any) => (
    <div data-testid="kyc-actions">
      {p.mode}|store={String(p.store)}|{p.labels?.store ?? '-'}
    </div>
  ),
}))
vi.mock('@controller/components/admin/ecom/tabs/ServiceApprovals', () => ({ default: (p: any) => <div data-testid="approvals">{p.services.join(',')}</div> }))
vi.mock('@controller/components/admin/ecom/tabs/KybSection', () => ({
  default: (p: any) => <div data-testid="kyb">kyb storeRequest={String(p.storeRequest)}</div>,
  readinessOf: () => ({ ready: true, verified: false, todo: [] }),
}))
vi.mock('@controller/components/admin/ecom/tabs/ComplianceDocRow', () => ({
  default: (p: any) => (
    <li data-testid="doc">
      {p.name}|{p.pending ? 'pending' : 'decided'}|{p.lapsed ? 'lapsed' : 'live'}
      {p.badge}
      {p.detail}
    </li>
  ),
}))

import KycTab from '@controller/components/admin/ecom/tabs/KycTab'

const tenant = (over: Record<string, unknown> = {}) => ({ id: 't1', service_types: ['store'], store_request: null, payment_required: true, razorpay_checkout_url: 'https://rzp.io/x', status: 'active', ...over }) as any
const kyc = (over: Record<string, unknown> = {}) =>
  ({ status: 'pending', reviewed_by: null, reviewed_at: null, reviewer_note: null, business_name: 'Acme Traders', business_type: 'proprietorship', gst_number: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', product_categories: 'Clothing', business_address: '1 MG Road', gst_cert_s3_key: null, ...over }) as any
const kybView = { docs: [] } as any
const doc = (over: Record<string, unknown> = {}) =>
  ({ id: 'd1', doc_type: 'fssai', status: 'pending', category: 'Food', doc_number: 'LIC-77', expires_on: null, created_at: '2026-11-01T00:00:00Z', s3_key: 'k', reviewed_at: null, reviewed_by: null, review_note: null, ...over }) as any

describe('KycTab', () => {
  it('without KYC says it was not submitted, and still shows verification and services', () => {
    render(<KycTab tenant={tenant()} kyc={null} kyb={kybView} />)
    expect(screen.getByText('This workspace has not submitted KYC details yet.')).toBeInTheDocument()
    expect(screen.getByTestId('kyb')).toBeInTheDocument()
    expect(screen.getByTestId('approvals')).toHaveTextContent('store')
  })

  it('tells the admin to reload when KYB could not be loaded', () => {
    render(<KycTab tenant={tenant()} kyc={null} kyb={null} />)
    expect(screen.getByText(/Couldn’t load the business verification/)).toBeInTheDocument()
    expect(screen.queryByTestId('kyb')).toBeNull()
  })

  it('pending KYC shows the approve/reject actions and the legacy business fields without KYB', () => {
    render(<KycTab tenant={tenant()} kyc={kyc()} kyb={null} />)
    expect(screen.getByText('KYC pending')).toBeInTheDocument()
    expect(screen.getByTestId('kyc-actions')).toHaveTextContent('pending|store=true')
    expect(screen.getByText('Acme Traders')).toBeInTheDocument()
    expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument()
    expect(screen.getByText('1 MG Road')).toBeInTheDocument()
    expect(screen.queryByText('Invalid format')).toBeNull()
  })

  it('flags malformed PAN and missing GSTIN', () => {
    render(<KycTab tenant={tenant()} kyc={kyc({ pan: 'BAD', gst_number: null })} kyb={null} />)
    expect(screen.getByText('Invalid format')).toBeInTheDocument()
    expect(screen.getByText('Not registered')).toBeInTheDocument()
  })

  it('labels a store upgrade application', () => {
    render(<KycTab tenant={tenant({ service_types: ['messaging'], store_request: 'pending' })} kyc={kyc()} kyb={kybView} />)
    expect(screen.getByText('Store upgrade')).toBeInTheDocument()
    expect(screen.getByTestId('kyc-actions')).toHaveTextContent('Store application')
  })

  it('approved KYC shows who approved it and the payment mode', () => {
    render(<KycTab tenant={tenant({ payment_required: false })} kyc={kyc({ status: 'approved', reviewed_by: 'admin@jeffistores.in', reviewed_at: '2026-11-10T00:00:00Z' })} kyb={kybView} />)
    expect(screen.getByText(/Approved by admin@jeffistores.in on/)).toHaveTextContent('payment optional')
    expect(screen.queryByTestId('kyc-actions')).toBeNull()
  })

  it('offers a retry when approved as mandatory but no payment link exists', () => {
    render(
      <KycTab tenant={tenant({ status: 'awaiting_payment', razorpay_checkout_url: null })} kyc={kyc({ status: 'approved', reviewed_by: 'a', reviewed_at: '2026-11-10T00:00:00Z' })} kyb={kybView} />,
    )
    expect(screen.getByTestId('kyc-actions')).toHaveTextContent('retry')
  })

  it('shows the rejection reason', () => {
    render(<KycTab tenant={tenant()} kyc={kyc({ status: 'rejected', reviewed_by: 'ops', reviewer_note: 'PAN does not match' })} kyb={kybView} />)
    expect(screen.getByText('KYC rejected')).toBeInTheDocument()
    expect(screen.getByText('Rejected by ops: PAN does not match')).toBeInTheDocument()
  })

  it('lists submitted licences with standing, expiry and the action-needed badge', () => {
    const past = '2020-01-01'
    render(<KycTab tenant={tenant()} kyc={kyc()} kyb={kybView} documents={[doc(), doc({ id: 'd2', doc_type: 'drug', expires_on: past })]} />)
    const rows = screen.getAllByTestId('doc')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('pending|live')
    expect(rows[0]).toHaveTextContent('LIC-77')
    expect(rows[1]).toHaveTextContent('lapsed')
    expect(rows[1]).toHaveTextContent('expired')
    expect(screen.getByText('Action needed')).toBeInTheDocument()
    expect(screen.getByText(/Approve or reject each one/)).toBeInTheDocument()
  })

  it('says no licences are on file for a store without any', () => {
    render(<KycTab tenant={tenant()} kyc={kyc()} kyb={kybView} documents={[]} />)
    expect(screen.getByText('No licences on file.')).toBeInTheDocument()
  })

  it('links the GST certificate sent with an older application', () => {
    render(<KycTab tenant={tenant()} kyc={kyc({ gst_cert_s3_key: 'gst.pdf' })} kyb={kybView} />)
    expect(screen.getByText('GST registration certificate')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute('href', '/api/admin/ecom/kyc/t1/cert')
  })

  it('an API workspace has no store fields or licence block', () => {
    render(<KycTab tenant={tenant({ service_types: ['messaging'] })} kyc={kyc({ product_categories: null })} kyb={kybView} />)
    expect(screen.queryByText('Licences & certificates')).toBeNull()
    expect(screen.getByTestId('kyc-actions')).toHaveTextContent('store=false')
  })
})
