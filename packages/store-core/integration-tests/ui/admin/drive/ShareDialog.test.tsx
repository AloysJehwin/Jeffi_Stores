import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const api = { shares: vi.fn(), people: vi.fn(), addShare: vi.fn(), removeShare: vi.fn() }
vi.mock('@/components/admin/drive/api', () => ({ driveApi: { shares: (...a: any[]) => api.shares(...a), people: (...a: any[]) => api.people(...a), addShare: (...a: any[]) => api.addShare(...a), removeShare: (...a: any[]) => api.removeShare(...a) } }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder ?? 'select'} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder ?? '-'}</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast: (t: string, k: string) => toast[k as 'error']?.(t) }) }))

import ShareDialog from '@/components/admin/drive/ShareDialog'

const target = { kind: 'folder' as const, id: 'f1' }
const people = { admins: [{ id: 'a1', name: 'Ravi', email: 'ravi@x.in', role: 'staff' }, { id: 'a2', name: null, email: 'meera@x.in', role: 'staff' }], roles: ['store_manager'] }
const shares = [{ id: 's1', adminId: 'a1', adminName: 'Ravi', role: null, level: 'edit' }, { id: 's2', adminId: null, adminName: null, role: 'store_manager', level: 'view' }]

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  Object.values(toast).forEach(f => f.mockReset())
  api.shares.mockResolvedValue({ shares })
  api.people.mockResolvedValue(people)
})

describe('ShareDialog', () => {
  it('lists who has access with their level', async () => {
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Share “Invoices”' })).toBeInTheDocument()
    expect(await screen.findByText('Ravi')).toBeInTheDocument()
    expect(screen.getByText('Role: Store Manager')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Can edit')
    expect(rows[1]).toHaveTextContent('Can view')
    expect(api.shares).toHaveBeenCalledWith(target)
  })

  it('says it is not shared yet', async () => {
    api.shares.mockResolvedValue({ shares: [] })
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    expect(await screen.findByText('Not shared with anyone yet.')).toBeInTheDocument()
  })

  it('offers only people and roles that do not have access yet, and Share needs a choice', async () => {
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    await screen.findByText('Ravi')
    const who = screen.getByLabelText('Choose a person or role')
    expect(within(who).queryByText('Ravi')).toBeNull()
    expect(within(who).queryByText(/Store Manager/)).toBeNull()
    expect(within(who).getByText('meera@x.in')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
  })

  it('shares with a person at the chosen level', async () => {
    api.addShare.mockResolvedValue({ shares: [...shares, { id: 's3', adminId: 'a2', adminName: 'meera@x.in', role: null, level: 'manage' }] })
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    await screen.findByText('Ravi')
    fireEvent.change(screen.getByLabelText('Choose a person or role'), { target: { value: 'admin:a2' } })
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], { target: { value: 'manage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(api.addShare).toHaveBeenCalledWith(target, { adminId: 'a2' }, 'manage'))
    await waitFor(() => expect(screen.getAllByRole('listitem')[2]).toHaveTextContent('Can manage'))
  })

  it('shares with a role', async () => {
    api.shares.mockResolvedValue({ shares: [] })
    api.addShare.mockResolvedValue({ shares: [] })
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    await screen.findByText('Not shared with anyone yet.')
    fireEvent.change(screen.getByLabelText('Choose a person or role'), { target: { value: 'role:store_manager' } })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(api.addShare).toHaveBeenCalledWith(target, { role: 'store_manager' }, 'view'))
  })

  it('shows an error toast when sharing fails', async () => {
    api.addShare.mockRejectedValue(new Error('Not allowed'))
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    await screen.findByText('Ravi')
    fireEvent.change(screen.getByLabelText('Choose a person or role'), { target: { value: 'admin:a2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not allowed'))
  })

  it('removes access and shows the returned list', async () => {
    api.removeShare.mockResolvedValue({ shares: [shares[1]] })
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    await screen.findByText('Ravi')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove access' })[0])
    await waitFor(() => expect(api.removeShare).toHaveBeenCalledWith(target, 's1'))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
  })

  it('toasts when loading the shares fails', async () => {
    api.shares.mockRejectedValue(new Error('Cannot list'))
    render(<ShareDialog target={target} name="Invoices" onClose={() => {}} />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot list'))
  })

  it('changes folder visibility and rolls it back on failure', async () => {
    const onVisibility = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Denied'))
    render(<ShareDialog target={target} name="Invoices" visibility="private" onVisibility={onVisibility} onClose={() => {}} />)
    await screen.findByText('Ravi')
    const vis = screen.getAllByRole('combobox')[0]
    expect(vis).toHaveValue('private')
    fireEvent.change(vis, { target: { value: 'team' } })
    await waitFor(() => expect(onVisibility).toHaveBeenCalledWith('team'))
    expect(vis).toHaveValue('team')
    fireEvent.change(vis, { target: { value: 'shared' } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Denied'))
    expect(vis).toHaveValue('team')
  })

  it('hides general access for files', async () => {
    render(<ShareDialog target={{ kind: 'file', id: 'x' }} name="a.png" onClose={() => {}} />)
    await screen.findByText('Ravi')
    expect(screen.queryByText('General access')).toBeNull()
  })
})
