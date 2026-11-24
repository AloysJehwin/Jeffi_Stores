import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/admin/ScopeGrid', () => ({
  default: ({ selected, onToggle, allowedKeys }: any) => (
    <div data-testid="grid" data-allowed={allowedKeys?.join(',') ?? ''}>
      <span>selected:{selected.join(',')}</span>
      <button type="button" onClick={() => onToggle('orders:read')}>toggle-orders</button>
    </div>
  ),
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="idle" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import AdminUserActions from '@/components/admin/AdminUserActions'
import { isPlatformOwner } from '@/lib/auth/scopes'

const admin = {
  id: 'a2',
  username: 'ravi',
  first_name: 'Ravi',
  last_name: 'K',
  role: 'admin',
  scopes: ['orders:read'],
  is_active: true,
  mfa_enabled: true,
  mobile_hint: '••1234' as string | null,
  last_login: null,
  created_at: '2026-01-01T00:00:00Z',
  idle_timeout_minutes: 120,
}

const ok = (body: unknown = {}) => ({ ok: true, json: async () => body })

describe('AdminUserActions', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
  })

  const mount = (over: Partial<typeof admin> = {}, props: Partial<React.ComponentProps<typeof AdminUserActions>> = {}) =>
    render(<AdminUserActions admin={{ ...admin, ...over }} currentAdminId="a1" {...props} />)

  it('shows You for the signed-in admin and no actions', () => {
    mount({ id: 'a1' })
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.queryByTitle('Delete')).toBeNull()
  })

  it('shows Super Admin for an owner and no actions', () => {
    const owner = ['super_admin', 'administrator', 'owner'].find(r => isPlatformOwner(r))!
    mount({ role: owner })
    expect(screen.getByText('Super Admin')).toBeInTheDocument()
    expect(screen.queryByTitle('Delete')).toBeNull()
  })

  it('offers 2FA and mobile reset only when applicable', () => {
    const first = mount({ mfa_enabled: false, mobile_hint: null })
    expect(screen.queryByTitle(/Reset 2FA/)).toBeNull()
    expect(screen.queryByTitle(/Reset mobile number/)).toBeNull()
    first.unmount()
    mount()
    expect(screen.getByTitle(/Reset 2FA/)).toBeInTheDocument()
    expect(screen.getByTitle(/Reset mobile number/)).toBeInTheDocument()
  })

  it('deactivate asks first, then PATCHes is_active=false and refreshes', async () => {
    mount()
    fireEvent.click(screen.getByTitle('Deactivate'))
    expect(screen.getByText('Deactivate?')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/users/a2')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ is_active: false })
  })

  it('an inactive admin offers Activate', async () => {
    const onUpdate = vi.fn()
    mount({ is_active: false }, { onUpdate })
    fireEvent.click(screen.getByTitle('Activate'))
    expect(screen.getByText('Activate?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ is_active: true })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('answering No cancels the confirmation', () => {
    mount()
    fireEvent.click(screen.getByTitle('Delete'))
    expect(screen.getByText('Delete?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.getByTitle('Delete')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delete confirms then sends DELETE', async () => {
    mount()
    fireEvent.click(screen.getByTitle('Delete'))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('reset 2FA and reset mobile confirm then PATCH their flags', async () => {
    mount()
    fireEvent.click(screen.getByTitle(/Reset 2FA/))
    expect(screen.getByText('Reset 2FA?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reset_mfa: true })
    fireEvent.click(screen.getByTitle(/Reset mobile number/))
    expect(screen.getByText('Reset mobile?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ reset_mobile: true })
  })

  it('resend email shows the result on the button title', async () => {
    mount()
    fireEvent.click(screen.getByTitle('Resend certificate email'))
    await waitFor(() => expect(screen.getByTitle('Email sent!')).toBeInTheDocument())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/users/a2/resend-certificate')
  })

  it('resend email surfaces an API error', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'SMTP down' }) })
    mount()
    fireEvent.click(screen.getByTitle('Resend certificate email'))
    await waitFor(() => expect(screen.getByTitle('SMTP down')).toBeInTheDocument())
  })

  it('opens the edit dialog with the admin name, role, scopes and idle timeout', () => {
    mount()
    fireEvent.click(screen.getByTitle('Edit scopes'))
    expect(screen.getByText('Edit admin')).toBeInTheDocument()
    expect(screen.getByText('Ravi K')).toBeInTheDocument()
    expect(screen.getByText('selected:orders:read')).toBeInTheDocument()
    expect(screen.getByLabelText('idle')).toHaveValue('120')
  })

  it('saves role, scopes and idle timeout', async () => {
    const onUpdate = vi.fn()
    mount({}, { onUpdate, allowedScopeKeys: ['orders:read', 'products:read'] })
    fireEvent.click(screen.getByTitle('Edit scopes'))
    expect(screen.getByTestId('grid')).toHaveAttribute('data-allowed', 'orders:read,products:read')
    fireEvent.click(screen.getByRole('button', { name: 'moderator' }))
    fireEvent.change(screen.getByLabelText('idle'), { target: { value: '' } })
    fireEvent.click(screen.getByText('toggle-orders'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ scopes: [], role: 'moderator', idle_timeout_minutes: null })
    expect(screen.queryByText('Edit admin')).toBeNull()
  })

  it('select all / deselect all toggles every grantable scope', () => {
    mount({ scopes: [] }, { allowedScopeKeys: ['orders:read', 'products:read'] })
    fireEvent.click(screen.getByTitle('Edit scopes'))
    expect(screen.getByText('0 of 2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }))
    expect(screen.getByText('0 of 2 selected')).toBeInTheDocument()
  })

  it('shows the API error and keeps the dialog open when saving fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Scope not in plan' }) })
    mount()
    fireEvent.click(screen.getByTitle('Edit scopes'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Scope not in plan')).toBeInTheDocument()
    expect(screen.getByText('Edit admin')).toBeInTheDocument()
  })

  it('cancel closes the dialog without saving', () => {
    mount()
    fireEvent.click(screen.getByTitle('Edit scopes'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Edit admin')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the username when there is no full name', () => {
    mount({ first_name: undefined, last_name: undefined })
    fireEvent.click(screen.getByTitle('Edit scopes'))
    expect(screen.getByText('ravi')).toBeInTheDocument()
  })
})
