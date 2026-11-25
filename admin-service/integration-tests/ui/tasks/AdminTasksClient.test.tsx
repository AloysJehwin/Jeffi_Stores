import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
const refresh = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  usePathname: () => '/admin/tasks',
  useSearchParams: () => sp,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: () => <div>filters</div> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="assignee" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import AdminTasksClient from '@admin/app/(admin)/admin/tasks/AdminTasksClient'

const day = (offset: number) => {
  const d = new Date('2026-06-15T12:00:00Z')
  d.setDate(d.getDate() + offset)
  return d.toISOString()
}
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  title: 'Call back customer',
  description: 'About the delayed order',
  due_date: day(-2),
  priority: 'urgent',
  status: 'pending',
  completed_at: null,
  auto_created: true,
  source_kind: 'stuck_shipment',
  source_ref_id: null,
  user_id: 'u1',
  customer_first_name: 'Asha',
  customer_last_name: 'Rao',
  customer_email: 'asha@x.test',
  assigned_to: null,
  assigned_first_name: null,
  assigned_last_name: null,
  assigned_username: null,
  ...over,
})
const tasks = [
  task(),
  task({ id: 't2', title: 'Send brochure', due_date: day(0), priority: 'low', auto_created: false, source_kind: null, customer_first_name: null, customer_last_name: null }),
  task({ id: 't3', title: 'Old chore', due_date: null, status: 'completed', priority: 'medium', auto_created: false, source_kind: null }),
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('AdminTasksClient', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    sp = new URLSearchParams()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const u = String(url)
      if (u.startsWith('/api/admin/admins')) return json(true, { admins: [{ id: 'a1', username: 'asha', role: 'staff', first_name: 'Asha', last_name: 'K' }] })
      if (init?.method === 'PATCH') return json(true)
      return json(true, { tasks, total: 3, totalPages: 1 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('groups tasks into due buckets with priority, segment and auto badges', async () => {
    render(asAdmin(<AdminTasksClient />))
    expect(await screen.findByText('Call back customer')).toBeInTheDocument()
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('2d overdue')).toBeInTheDocument()
    expect(screen.getByText('Due today')).toBeInTheDocument()
    expect(screen.getByText('urgent')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
    expect(screen.getByText('auto')).toBeInTheDocument()
    expect(screen.getByText('3 tasks')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Asha Rao' })[0]).toHaveAttribute('href', expect.stringContaining('/admin/customers/u1/view'))
    const url = String(fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/admin/tasks'))![0])
    expect(url).toContain('scope=all')
    expect(url).toContain('status=all')
  })

  it('shows the clean empty state', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/admin/admins') ? json(true, { admins: [] }) : json(true, { tasks: [], total: 0 })))
    render(asAdmin(<AdminTasksClient />))
    expect(await screen.findByText('No tasks here. Nice and clean.')).toBeInTheDocument()
  })

  it('an empty search offers to clear it', async () => {
    sp = new URLSearchParams('search=zzz')
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/admin/admins') ? json(true, { admins: [] }) : json(true, { tasks: [], total: 0 })))
    render(asAdmin(<AdminTasksClient />))
    const clear = await screen.findByRole('button', { name: 'Clear search' })
    fireEvent.click(clear)
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining('search='), { scroll: false })
  })

  it('completes a task: PATCHes status, toasts and refreshes', async () => {
    render(asAdmin(<AdminTasksClient />))
    await screen.findByText('Call back customer')
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark complete' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Task completed', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/admin/customers/u1/tasks/t1')
    expect(JSON.parse(patch[1].body)).toEqual({ status: 'completed' })
    expect(refresh).toHaveBeenCalled()
  })

  it('reopens a completed task', async () => {
    render(asAdmin(<AdminTasksClient />))
    await screen.findByText('Old chore')
    fireEvent.click(screen.getByRole('button', { name: 'Mark incomplete' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Task reopened', 'success'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ status: 'pending' })
  })

  it('toasts when the update fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const u = String(url)
      if (u.startsWith('/api/admin/admins')) return json(true, { admins: [] })
      if (init?.method === 'PATCH') return json(false)
      return json(true, { tasks, total: 3 })
    })
    render(asAdmin(<AdminTasksClient />))
    await screen.findByText('Call back customer')
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark complete' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not update the task', 'error'))
  })

  it('reassigns a task to another admin', async () => {
    render(asAdmin(<AdminTasksClient />))
    await screen.findByText('Call back customer')
    await screen.findAllByRole('option', { name: 'Asha K' })
    fireEvent.change(screen.getAllByLabelText('assignee')[0], { target: { value: 'a1' } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Task reassigned', 'success'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ assigned_to: 'a1' })
  })

  it('is read-only without tasks write: no assignee select and the checkbox is disabled', async () => {
    render(asMember(<AdminTasksClient />, ['tasks:read']))
    await screen.findByText('Call back customer')
    expect(screen.queryAllByLabelText('assignee')).toHaveLength(0)
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0)
    for (const b of screen.getAllByRole('button', { name: /Mark (in)?complete/ })) expect(b).toBeDisabled()
  })
})
