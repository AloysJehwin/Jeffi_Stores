import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/detail/CertsTable', () => ({ default: ({ certs }: any) => <div data-testid="certs">{certs.length} certs</div> }))
vi.mock('@controller/components/admin/ecom/detail/IssueCertButton', () => ({
  default: (p: any) => (
    <button type="button">
      Issue {p.ownerEmail} active={String(p.hasActive)}
    </button>
  ),
}))

import CertificatesTab from '@controller/components/admin/ecom/tabs/CertificatesTab'

const day = 86_400_000
const cert = (over: Record<string, unknown>) => ({ id: 'c', common_name: 'owner@acme.in', issued_to: 'owner@acme.in', expires_at: new Date(Date.now() + 90 * day).toISOString(), revoked_at: null, ...over }) as any
const tenant = (over: Record<string, unknown> = {}) => ({ id: 't1', slug: 'acme', rds_endpoint: 'db.acme:5432', ...over }) as any

describe('CertificatesTab', () => {
  it('shows an active owner certificate, the CA and the client certificate table', () => {
    const ca = { subject: 'CN=Acme Admin CA', expiresAt: new Date(Date.now() + 200 * day) }
    render(<CertificatesTab tenant={tenant()} certs={[cert({ id: 'c1' }), cert({ id: 'c2', common_name: 'x@acme.in', issued_to: 'x@acme.in', revoked_at: '2026-01-01' })]} ca={ca} ownerEmail="owner@acme.in" />)
    expect(screen.getByText('owner@acme.in')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('CN=Acme Admin CA')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByTestId('certs')).toHaveTextContent('2 certs')
    expect(screen.getByRole('button', { name: /Issue owner@acme.in active=true/ })).toBeInTheDocument()
  })

  it('explains the missing CA and empty certificate list for a fresh store', () => {
    render(<CertificatesTab tenant={tenant()} certs={[]} ca={null} ownerEmail="owner@acme.in" />)
    expect(screen.getByText('Not issued')).toBeInTheDocument()
    expect(screen.getByText(/No CA issued for this tenant yet/)).toBeInTheDocument()
    expect(screen.getByText(/admin-acme.jeffistores.in/)).toBeInTheDocument()
    expect(screen.getByText(/Nobody can reach this store's admin panel over mTLS/)).toBeInTheDocument()
    expect(screen.queryByTestId('certs')).toBeNull()
  })

  it('flags an expired owner certificate and a revoked one', () => {
    const expired = cert({ expires_at: new Date(Date.now() - 5 * day).toISOString() })
    const { unmount } = render(<CertificatesTab tenant={tenant()} certs={[expired]} ca={null} ownerEmail="owner@acme.in" />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
    unmount()
    render(<CertificatesTab tenant={tenant()} certs={[cert({ revoked_at: '2026-01-01' })]} ca={null} ownerEmail="owner@acme.in" />)
    expect(screen.getByText('Revoked')).toBeInTheDocument()
  })

  it('reports the expiry countdown of the CA', () => {
    render(<CertificatesTab tenant={tenant()} certs={[]} ca={{ subject: 'CN=CA', expiresAt: new Date(Date.now() - 3 * day - 1000) }} ownerEmail={null} />)
    expect(screen.getByText(/expired 4d ago|expired 3d ago/)).toBeInTheDocument()
    expect(screen.getByText('No owner linked')).toBeInTheDocument()
  })

  it('cannot issue before the store has its database', () => {
    render(<CertificatesTab tenant={tenant({ rds_endpoint: null })} certs={[]} ca={null} ownerEmail="owner@acme.in" />)
    expect(screen.getByText(/Certificates can be issued once the store has its database/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Issue/ })).toBeNull()
  })
})
