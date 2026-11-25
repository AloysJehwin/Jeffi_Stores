import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="status" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import BrandApprovalsPanel from '@/components/admin/channels/BrandApprovalsPanel'

const brand = (over: Record<string, unknown>) => ({
  brandId: 'b1', brandName: 'Bosch', productCount: 12, status: null, allowed: false, source: null, note: null, approvalUrl: null, checkedAt: null, updatedBy: null, updatedAt: null, ...over,
})
const payload = {
  channel: 'amazon',
  requiresApproval: true,
  brands: [
    brand({}),
    brand({ brandId: 'b2', brandName: 'Makita', productCount: 3, status: 'approved', allowed: true, source: 'manual', updatedBy: 'Asha', updatedAt: '2026-03-01T10:00:00Z', note: 'Letter on file' }),
    brand({ brandId: 'b3', brandName: 'Dewalt', status: 'not_approved', source: 'amazon_restrictions', checkedAt: '2026-03-02T10:00:00Z', approvalUrl: 'https://amazon.in/approve' }),
  ],
}
const ok = (data: unknown) => ({ ok: true, json: async () => data })

describe('BrandApprovalsPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(ok(payload))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists brands with statuses and the blocked count', async () => {
    render(<BrandApprovalsPanel channel="amazon" />)
    expect(await screen.findByText('Bosch')).toBeInTheDocument()
    expect(screen.getByText(/2 of 3 brands are held back/)).toBeInTheDocument()
    expect(screen.getByText('No decision (blocked)')).toBeInTheDocument()
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0)
    expect(screen.getByText('Letter on file')).toBeInTheDocument()
    expect(screen.getByText(/By hand · Asha/)).toBeInTheDocument()
    expect(screen.getByText(/Checked with Amazon/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Request approval on Amazon/ })).toHaveAttribute('href', 'https://amazon.in/approve')
  })

  it('filters by search and blocked-only, with an empty message', async () => {
    render(<BrandApprovalsPanel channel="amazon" />)
    await screen.findByText('Bosch')
    fireEvent.change(screen.getByPlaceholderText('Search brands…'), { target: { value: 'maki' } })
    expect(screen.queryByText('Bosch')).not.toBeInTheDocument()
    expect(screen.getByText('Makita')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blocked only' }))
    expect(screen.getByText('No brands match.')).toBeInTheDocument()
  })

  it('saves a status change and toasts', async () => {
    render(<BrandApprovalsPanel channel="amazon" />)
    await screen.findByText('Bosch')
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'PUT' ? ok({}) : ok(payload)))
    fireEvent.change(screen.getAllByLabelText('status')[0], { target: { value: 'approved' } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Bosch: approved.', 'success'))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body)).toMatchObject({ brandId: 'b1', status: 'approved' })
  })

  it('checks with Amazon and shows the summary', async () => {
    render(<BrandApprovalsPanel channel="amazon" />)
    await screen.findByText('Bosch')
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/check') ? ok({ ok: true, checked: 3, approved: 1, notApproved: 2, manualKept: 1, noAsin: 0, errors: [{ brand: 'Bosch', error: 'throttled' }] }) : ok(payload)))
    fireEvent.click(screen.getByRole('button', { name: /Check with Amazon/ }))
    expect(await screen.findByText(/Checked 3 brand\(s\) with Amazon: 1 approved, 2 need approval/)).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Checked 3 brands with 1 error(s).', 'warning')
    expect(screen.getByText('1 brand(s) could not be checked')).toBeInTheDocument()
  })

  it('hides the status controls and Amazon check without write permission, and shows load errors', async () => {
    canWrite = false
    render(<BrandApprovalsPanel channel="amazon" />)
    await screen.findByText('Bosch')
    expect(screen.queryByLabelText('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Check with Amazon/ })).not.toBeInTheDocument()
  })

  it('shows an error state when brands cannot load', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Cannot load' }) })
    render(<BrandApprovalsPanel channel="gmc" />)
    expect(await screen.findByText('Cannot load')).toBeInTheDocument()
  })
})
