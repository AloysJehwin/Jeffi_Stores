import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const can = vi.hoisted(() => ({ write: true }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => can.write }))
vi.mock('@/components/admin/kit/toast', () => ({ useActionToast: () => toast }))
vi.mock('@controller/app/(admin)/admin/ecom/outreach/CallPanelClient', () => ({ default: ({ callId }: { callId: string }) => createElement('div', { 'data-testid': 'call-panel' }, callId) }))
vi.mock('@controller/app/(admin)/admin/ecom/outreach/AddJobs', () => ({ default: () => createElement('div', { 'data-testid': 'add-jobs' }) }))

import AgentJobsClient from '@controller/app/(admin)/admin/ecom/outreach/AgentJobsClient'
import JobDetailClient from '@controller/app/(admin)/admin/ecom/outreach/JobDetailClient'

const calls: { url: string; init?: RequestInit }[] = []
let routes: Record<string, (init?: RequestInit) => unknown> = {}

beforeEach(() => {
  calls.length = 0
  can.write = true
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(routes).find(k => `${init?.method ?? 'GET'} ${url}`.startsWith(k))
      const body = key ? routes[key](init) : { error: 'no route' }
      const ok = !(body && typeof body === 'object' && 'error' in (body as object))
      return { ok, json: async () => body } as Response
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const B = '/api/admin/ecom/outreach'
const row = (o: object = {}) => ({
  id: 'j1', status: 'completed', outcome: 'interested', source: 'csv', source_ref: null, due_at: '2026-11-26T10:00:00Z', created_at: '2026-11-26T09:00:00Z', ended_at: '2026-11-26T10:05:00Z',
  contact: { id: 'c1', name: 'Asha Rao', phone_last4: '3210' }, inputs: {}, ...o,
})
const page = (rows: object[], total = rows.length) => ({ rows, total, page: 1, pageSize: 25 })
const jobsUrl = (agent = 'a1') => `GET ${B}/agents/${agent}/jobs`

const renderList = (props: Partial<Parameters<typeof AgentJobsClient>[0]> = {}) =>
  render(<AgentJobsClient agentId="a1" agentStatus="active" inputs={{}} outcomes={['interested', 'not_interested']} canWrite {...props} />)

describe('AgentJobsClient', () => {
  it('renders the jobs with masked phone, status and outcome', async () => {
    routes = { [jobsUrl()]: () => page([row(), row({ id: 'j2', status: 'failed', outcome: null, source: 'event', contact: { id: 'c2', name: null, phone_last4: '9999' } })]) }
    renderList()
    expect(await screen.findByText('Asha Rao')).toBeTruthy()
    expect(screen.getByText('••3210')).toBeTruthy()
    expect(screen.getByText('••9999')).toBeTruthy()
    expect(screen.getAllByText('interested').some(e => e.tagName === 'TD')).toBe(true)
    expect(screen.getByText('CSV')).toBeTruthy()
    expect(screen.getByText('Event')).toBeTruthy()
    expect(screen.getByText('2 jobs')).toBeTruthy()
    expect(screen.queryByText('9876543210')).toBeNull()
    expect(calls[0].url).toBe(`${B}/agents/a1/jobs?page=1`)
  })

  it('shows the empty state', async () => {
    routes = { [jobsUrl()]: () => page([]) }
    renderList()
    expect(await screen.findByText('No jobs match.')).toBeTruthy()
  })

  it('shows the load error', async () => {
    routes = { [jobsUrl()]: () => ({ error: 'Boom' }) }
    renderList()
    expect(await screen.findByText('Boom')).toBeTruthy()
  })

  it('the status and outcome filters change the request and reset the page', async () => {
    routes = { [jobsUrl()]: () => page([row()], 60) }
    renderList()
    await screen.findByText('Asha Rao')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(calls.some(c => c.url.includes('page=2'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    await waitFor(() => expect(calls.at(-1)!.url).toBe(`${B}/agents/a1/jobs?page=1&status=failed`))
    expect((screen.getByRole('button', { name: 'Failed' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByLabelText('Filter by outcome'), { target: { value: 'not_interested' } })
    await waitFor(() => expect(calls.at(-1)!.url).toBe(`${B}/agents/a1/jobs?page=1&status=failed&outcome=not_interested`))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(calls.at(-1)!.url).toBe(`${B}/agents/a1/jobs?page=1&outcome=not_interested`))
  })

  it('toggles Add jobs, and disables it without write access', async () => {
    routes = { [jobsUrl()]: () => page([row()]) }
    const { unmount } = renderList()
    await screen.findByText('Asha Rao')
    fireEvent.click(screen.getByRole('button', { name: 'Add jobs' }))
    expect(screen.getByTestId('add-jobs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('add-jobs')).toBeNull()
    unmount()
    renderList({ canWrite: false })
    expect((await screen.findByRole('button', { name: 'Add jobs' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens a job and returns to a refreshed list', async () => {
    routes = {
      [jobsUrl()]: () => page([row()]),
      [`GET ${B}/jobs/j1`]: () => detail(),
    }
    renderList()
    fireEvent.click(await screen.findByRole('button', { name: 'Open job for Asha Rao' }))
    expect(await screen.findByText('Back to jobs')).toBeTruthy()
    const before = calls.filter(c => c.url.startsWith(`${B}/agents/a1/jobs`)).length
    fireEvent.click(screen.getByRole('button', { name: 'Back to jobs' }))
    expect(await screen.findByText('Asha Rao')).toBeTruthy()
    await waitFor(() => expect(calls.filter(c => c.url.startsWith(`${B}/agents/a1/jobs`)).length).toBeGreaterThan(before))
  })
})

const job = (o: object = {}) => ({
  id: 'j1', status: 'queued', outcome: null, source: 'csv', source_ref: 'row-7', attempts: 2, due_at: '2026-11-26T10:00:00Z', ended_at: null, created_at: '2026-11-26T09:00:00Z', updated_at: '2026-11-26T09:30:00Z',
  inputs: { name: 'Asha', phone: '9876543210', note: '' }, refs: { order: { id: 'o1', number: 'ORD-42', total: 1200, placed_at: '2026-11-25T08:00:00Z' } }, result: null, ...o,
})
const detail = (o: { job?: object; [k: string]: unknown } = {}) => ({
  job: job(o.job),
  contact: { id: 'c1', kind: 'shopper', phone: '+919876543210', owner_name: 'Asha Rao', business_name: null, language: 'en', status: 'new', consent_whatsapp_at: null, opted_out_at: null, dnd_status: null, handoff_at: null, handoff_reason: null },
  run: { skill_ref: 'cart-nudge@3', status: 'running', turns: 4, spend_paise: 250, last_channel: 'whatsapp', started_at: '2026-11-26T09:10:00Z' },
  calls: [{ id: 'call1', status: 'completed', created_at: '2026-11-26T09:11:00Z', started_at: null, outcome: 'interested', duration_s: 42, summary: 'Wants the blue one' }],
  messages: [{ id: 'm1', direction: 'inbound', created_at: '2026-11-26T09:12:00Z', template_slug: null, status: 'received', body: 'Yes please' }],
  toolCalls: [{ id: 't1', created_at: '2026-11-26T09:13:00Z', data: { tool: 'sendWhatsapp', ok: false, error: 'window closed', channel: 'whatsapp', args: { to: 'x' } } }],
  ...o,
  ...(o.job ? { job: job(o.job) } : {}),
})

describe('JobDetailClient', () => {
  const open = (onBack = vi.fn()) => render(<JobDetailClient jobId="j1" onBack={onBack} />)

  it('renders inputs, resolved references, contact, run, calls, messages and tool calls', async () => {
    routes = { [`GET ${B}/jobs/j1`]: () => detail() }
    open()
    expect(await screen.findByText('Queued')).toBeTruthy()
    expect(screen.getByText('row-7')).toBeTruthy()
    expect(screen.getByText('Asha Rao')).toBeTruthy()
    expect(screen.getAllByText('••••3210').length).toBe(2)
    expect(screen.queryByText('9876543210')).toBeNull()
    expect(screen.queryByText('+919876543210')).toBeNull()
    expect(screen.getByText('order')).toBeTruthy()
    expect(screen.getByText('ORD-42')).toBeTruthy()
    expect(screen.getByText('cart-nudge@3')).toBeTruthy()
    expect(screen.getByText('Wants the blue one')).toBeTruthy()
    expect(screen.getByTestId('call-panel').textContent).toBe('call1')
    expect(screen.getByText('Yes please')).toBeTruthy()
    expect(screen.getByText('sendWhatsapp')).toBeTruthy()
    expect(screen.getByText('window closed')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the contact' }).getAttribute('href')).toContain('/contacts/c1')
  })

  it('shows empty sections when there is nothing to list', async () => {
    routes = { [`GET ${B}/jobs/j1`]: () => detail({ calls: [], messages: [], toolCalls: [], run: null, job: { inputs: {}, refs: {} } }) }
    open()
    expect(await screen.findByText('No inputs.')).toBeTruthy()
    expect(screen.getByText('No calls yet.')).toBeTruthy()
    expect(screen.getByText('No messages.')).toBeTruthy()
    expect(screen.getByText('No tool calls.')).toBeTruthy()
    expect(screen.queryByText('Resolved references')).toBeNull()
  })

  it('shows the load error', async () => {
    routes = { [`GET ${B}/jobs/j1`]: () => ({ error: 'Job not found' }) }
    open()
    expect(await screen.findByText('Job not found')).toBeTruthy()
  })

  it('Back calls onBack', async () => {
    routes = { [`GET ${B}/jobs/j1`]: () => detail() }
    const onBack = vi.fn()
    open(onBack)
    fireEvent.click(await screen.findByRole('button', { name: 'Back to jobs' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('Cancel asks to confirm, then PATCHes cancel and reloads', async () => {
    let status = 'queued'
    routes = {
      [`PATCH ${B}/jobs/j1`]: () => {
        status = 'cancelled'
        return { job: { id: 'j1', status } }
      },
      [`GET ${B}/jobs/j1`]: () => detail({ job: { status } }),
    }
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel job' }))
    expect(screen.getByText(/nothing more is sent/)).toBeTruthy()
    expect(calls.some(c => c.init?.method === 'PATCH')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByRole('button', { name: 'Confirm cancel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Job cancelled'))
    const patch = calls.find(c => c.init?.method === 'PATCH')!
    expect(patch.url).toBe(`${B}/jobs/j1`)
    expect(JSON.parse(patch.init!.body as string)).toEqual({ action: 'cancel' })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('Retry PATCHes retry on a failed job', async () => {
    routes = {
      [`PATCH ${B}/jobs/j1`]: () => ({ job: { id: 'j1', status: 'queued' } }),
      [`GET ${B}/jobs/j1`]: () => detail({ job: { status: 'failed' } }),
    }
    open()
    expect(screen.queryByText('Cancel job')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Job queued again'))
    expect(JSON.parse(calls.find(c => c.init?.method === 'PATCH')!.init!.body as string)).toEqual({ action: 'retry' })
  })

  it('toasts the server error when the PATCH fails', async () => {
    routes = {
      [`PATCH ${B}/jobs/j1`]: () => ({ error: 'The job has already ended' }),
      [`GET ${B}/jobs/j1`]: () => detail(),
    }
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel job' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The job has already ended'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('hides Cancel and Retry without write access', async () => {
    can.write = false
    routes = { [`GET ${B}/jobs/j1`]: () => detail() }
    open()
    await screen.findByText('Queued')
    expect(screen.queryByRole('button', { name: 'Cancel job' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})
