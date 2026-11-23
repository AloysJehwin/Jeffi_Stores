import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))

import IssueCertButton from '@controller/components/admin/ecom/detail/IssueCertButton'

describe('IssueCertButton (render + dialog + interaction)', () => {
  it('labels the trigger Issue when there is no active cert', () => {
    render(<IssueCertButton tenantId="t1" ownerEmail="owner@store.in" hasActive={false} />)
    expect(screen.getByRole('button', { name: /Issue certificate/ })).toBeInTheDocument()
  })

  it('labels the trigger Re-issue when a cert is active', () => {
    render(<IssueCertButton tenantId="t1" ownerEmail="owner@store.in" hasActive />)
    expect(screen.getByRole('button', { name: /Re-issue certificate/ })).toBeInTheDocument()
  })

  it('opens the dialog pre-filled with the owner email', () => {
    render(<IssueCertButton tenantId="t1" ownerEmail="owner@store.in" hasActive={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Issue certificate/ }))
    expect(screen.getByText('Issue admin certificate')).toBeInTheDocument()
    expect(screen.getByDisplayValue('owner@store.in')).toBeInTheDocument()
  })

  it('warns when the email is not the owner', () => {
    render(<IssueCertButton tenantId="t1" ownerEmail="owner@store.in" hasActive={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Issue certificate/ }))
    const email = screen.getByDisplayValue('owner@store.in') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'someone@else.in' } })
    expect(screen.getByText(/another super_admin/)).toBeInTheDocument()
  })

  it('POSTs the issue request with the email and revoke flag', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ issuedTo: 'owner@store.in', revoked: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<IssueCertButton tenantId="shopC" ownerEmail="owner@store.in" hasActive={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Issue certificate/ }))
    fireEvent.submit(document.getElementById('issue-cert-form') as HTMLFormElement)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/shopC/certs/issue')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'owner@store.in', revokeExisting: false })
  })
})
