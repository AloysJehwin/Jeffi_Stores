import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// DataTable + RowActions read these contexts; stub them so the table renders without providers.
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>(), push: vi.fn<(...a: any[]) => any>() }),
  usePathname: () => '/admin/ecom/t1',
  useSearchParams: () => new URLSearchParams(),
}))

import CertsTable from '@controller/components/admin/ecom/detail/CertsTable'
import type { AdminCertRow } from '@/lib/tenancy/tenant-ca'

const future = new Date(Date.now() + 90 * 86_400_000).toISOString()
const past = new Date(Date.now() - 10 * 86_400_000).toISOString()

const certs = (): AdminCertRow[] =>
  [
    { id: 'c1', common_name: 'owner@store.in', issued_to: 'owner@store.in', serial: 'AABBCCDDEEFF00112233', issued_at: past, expires_at: future, revoked_at: null, revoked_by: null },
    { id: 'c2', common_name: 'old@store.in', issued_to: 'old@store.in', serial: 'FFEEDDCCBBAA99887766', issued_at: past, expires_at: past, revoked_at: null, revoked_by: null },
  ] as unknown as AdminCertRow[]

describe('CertsTable (render + branches)', () => {
  it('renders the empty message with no certs', () => {
    render(<CertsTable tenantId="t1" certs={[]} />)
    expect(screen.getByText(/No client certificates issued/)).toBeInTheDocument()
  })

  it('lists holders and marks active vs expired state', () => {
    render(<CertsTable tenantId="t1" certs={certs()} />)
    expect(screen.getAllByText('owner@store.in').length).toBeGreaterThan(0)
    expect(screen.getAllByText('old@store.in').length).toBeGreaterThan(0)
    // the future cert is active, the past one expired.
    expect(screen.getAllByText('active').length).toBeGreaterThan(0)
    expect(screen.getAllByText('expired').length).toBeGreaterThan(0)
  })
})
