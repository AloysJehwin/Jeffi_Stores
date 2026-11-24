import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/admin/ScopeGrid', () => ({
  default: ({ selected, onToggle, onSelectAll, onClearAll, allowedKeys }: any) => (
    <div data-testid="grid" data-allowed={allowedKeys?.join(',') ?? ''}>
      <span>selected:{selected.join(',')}</span>
      <button type="button" onClick={() => onToggle('orders:read')}>toggle-orders</button>
      <button type="button" onClick={onSelectAll}>all</button>
      <button type="button" onClick={onClearAll}>none</button>
    </div>
  ),
}))

import CreateAdminForm from '@/components/admin/CreateAdminForm'

const json = (ok: boolean, body: unknown) => ({ ok, json: async () => body })

async function openAndFill() {
  fireEvent.click(screen.getByRole('button', { name: 'Create New Admin' }))
  fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Asha' } })
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Rao' } })
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'asha@shop.test' } })
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /Create Admin & Generate Certificate/ }))

describe('CreateAdminForm', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  })

  it('starts collapsed and opens the form', async () => {
    render(<CreateAdminForm />)
    expect(screen.queryByLabelText(/Email/)).toBeNull()
    await openAndFill()
    expect(screen.getByLabelText(/Email/)).toHaveValue('asha@shop.test')
  })

  it('cancel collapses the form again', async () => {
    render(<CreateAdminForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Create New Admin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Create New Admin' })).toBeInTheDocument()
  })

  it('manages the scope selection and passes the plan allow-list to the grid', () => {
    render(<CreateAdminForm allowedScopeKeys={['orders:read', 'products:read']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create New Admin' }))
    expect(screen.getByTestId('grid')).toHaveAttribute('data-allowed', 'orders:read,products:read')
    fireEvent.click(screen.getByText('toggle-orders'))
    expect(screen.getByText('selected:orders:read')).toBeInTheDocument()
    fireEvent.click(screen.getByText('toggle-orders'))
    expect(screen.getByText('selected:')).toBeInTheDocument()
    fireEvent.click(screen.getByText('all'))
    expect(screen.getByText('selected:orders:read,products:read')).toBeInTheDocument()
    fireEvent.click(screen.getByText('none'))
    expect(screen.getByText('selected:')).toBeInTheDocument()
  })

  it('switches the role', () => {
    render(<CreateAdminForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Create New Admin' }))
    fireEvent.click(screen.getByRole('button', { name: 'moderator' }))
    expect(screen.getByRole('button', { name: 'moderator' }).className).toMatch(/border-accent-500/)
  })

  it('posts the form and shows the portal-invite result', async () => {
    fetchMock.mockResolvedValue(
      json(true, { emailSent: true, portalInvite: true, portalUrl: 'https://portal.shop.test/cert' })
    )
    const onCreated = vi.fn()
    render(<CreateAdminForm onCreated={onCreated} />)
    await openAndFill()
    fireEvent.click(screen.getByText('toggle-orders'))
    submit()
    expect(await screen.findByText('Admin Created Successfully')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/users')
    expect(JSON.parse(init.body)).toEqual({
      email: 'asha@shop.test', first_name: 'Asha', last_name: 'Rao', role: 'admin', scopes: ['orders:read'],
    })
    expect(onCreated).toHaveBeenCalled()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText(/An invitation was sent/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'portal.shop.test/cert' })).toBeInTheDocument()
    expect(screen.getByText(/Certificate emailed/)).toBeInTheDocument()
  })

  it('downloads the certificate and shows its one-time password when not invited via portal', async () => {
    fetchMock.mockResolvedValue(
      json(true, {
        emailSent: false,
        certificate: { p12Base64: btoa('cert'), p12Password: 'S3cret!', serialNumber: 'AB12', expiresAt: '2027-01-02T00:00:00Z' },
      })
    )
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<CreateAdminForm />)
    await openAndFill()
    submit()
    expect(await screen.findByText('S3cret!')).toBeInTheDocument()
    expect(click).toHaveBeenCalled()
    expect(screen.getByText('AB12')).toBeInTheDocument()
    expect(screen.getByText(/Email delivery failed/)).toBeInTheDocument()
    expect(screen.getByText(/Save the password above/)).toBeInTheDocument()
  })

  it('Done returns to the collapsed button', async () => {
    fetchMock.mockResolvedValue(json(true, { emailSent: true }))
    render(<CreateAdminForm />)
    await openAndFill()
    submit()
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Create New Admin' })).toBeInTheDocument()
  })

  it('shows the API error and keeps the form', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Email already in use' }))
    render(<CreateAdminForm />)
    await openAndFill()
    submit()
    expect(await screen.findByText('Email already in use')).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/)).toHaveValue('asha@shop.test')
  })

  it('shows a network error when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    render(<CreateAdminForm />)
    await openAndFill()
    submit()
    await waitFor(() => expect(screen.getByText('Network error. Please try again.')).toBeInTheDocument())
  })
})
