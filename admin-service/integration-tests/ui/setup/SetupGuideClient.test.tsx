import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/setup',
  useSearchParams: () => new URLSearchParams(),
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange }: any) => <input aria-label="Applied on" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@admin/app/(admin)/admin/setup/_components/SetupLoading', () => ({ PlatformAppsLoading: () => <div>platform-loading</div> }))

import SetupGuideClient from '@admin/app/(admin)/admin/setup/_components/SetupGuideClient'

const step = (over: Record<string, unknown> = {}): any => ({
  id: 's1', section: 'sec1', title: 'Add your logo', why: 'Shows on invoices', status: 'todo', optional: false, canOpen: true, href: '/admin/settings/brand',
  external: false, manual: null, ...over,
})
const payload = (over: Record<string, unknown> = {}): any => ({
  canWrite: true,
  platform: false,
  counts: { total: 4, done: 1, in_progress: 1, needs_attention: 1, todo: 1, skipped: 0 },
  sections: [{ id: 'sec1', title: 'Branding' }, { id: 'sec2', title: 'Payments' }],
  steps: [
    step(),
    step({ id: 's2', title: 'Connect Razorpay', why: 'Take payments', status: 'needs_attention', section: 'sec2', connect: '/admin/integrations/razorpay', detail: 'Key rejected' }),
    step({ id: 's3', title: 'Verify domain', why: 'Email deliverability', status: 'in_progress', section: 'sec2', optional: true }),
    step({ id: 's4', title: 'Set tax', why: 'GST', status: 'done', section: 'sec1', manual: { state: 'applied', applied_at: '2026-03-04', note: 'Ref 12' } }),
  ],
  ...over,
})
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('SetupGuideClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json(true, payload()))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows overall progress and the steps with status, why, detail and manual notes', () => {
    render(asAdmin(<SetupGuideClient initial={payload()} />, ['setup_guide:write']))
    expect(screen.getByText('1 of 4 done')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('1 need attention ·', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Add your logo')).toBeInTheDocument()
    expect(screen.getByText('Key rejected')).toBeInTheDocument()
    expect(screen.getByText('Optional')).toBeInTheDocument()
    expect(screen.getByText('Needs attention', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Waiting', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/You applied on/)).toHaveTextContent('· Ref 12')
  })

  it('open steps get Open/Connect links; a step that is done offers Edit', () => {
    render(asAdmin(<SetupGuideClient initial={payload()} />, ['setup_guide:write']))
    expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute('href', expect.stringContaining('/admin/integrations/razorpay'))
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', expect.stringContaining('/admin/settings/brand'))
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument()
  })

  it('shows a no-access note when the admin cannot open the step page', () => {
    render(asAdmin(<SetupGuideClient initial={payload({ steps: [step({ canOpen: false })] })} />))
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument()
  })

  it('filters by status and shows the empty view', () => {
    render(asAdmin(<SetupGuideClient initial={payload()} />))
    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    expect(screen.getByText('Set tax')).toBeInTheDocument()
    expect(screen.queryByText('Add your logo')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Done/ })).toHaveAttribute('aria-pressed', 'true')
    cleanupToEmpty()
  })

  function cleanupToEmpty() {
    fireEvent.click(screen.getByRole('button', { name: /^To do/ }))
    expect(screen.getByText('Add your logo')).toBeInTheDocument()
  }

  it('shows "No steps in this view." when a filter matches nothing', () => {
    render(asAdmin(<SetupGuideClient initial={payload({ steps: [step({ status: 'done' })] })} />))
    fireEvent.click(screen.getByRole('button', { name: /^To do/ }))
    expect(screen.getByText('No steps in this view.')).toBeInTheDocument()
  })

  it('Skip saves the manual state with PATCH and reloads the guide', async () => {
    render(asAdmin(<SetupGuideClient initial={payload()} />, ['setup_guide:write']))
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip' })[0])
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/admin/setup-guide').length).toBe(1))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(url).toBe('/api/admin/setup-guide/s1')
    expect(JSON.parse(init.body)).toEqual({ state: 'skipped' })
  })

  it('Mark applied asks for a date and note, then saves them', async () => {
    render(asAdmin(<SetupGuideClient initial={payload()} />, ['setup_guide:write']))
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark applied' })[0])
    fireEvent.change(screen.getByLabelText('Applied on'), { target: { value: '2026-03-01' } })
    fireEvent.change(screen.getByPlaceholderText('Reference number, contact…'), { target: { value: 'TKT-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(init.body)).toEqual({ state: 'applied', appliedAt: '2026-03-01', note: 'TKT-5' })
  })

  it('Cancel leaves the applied form without saving', () => {
    render(asAdmin(<SetupGuideClient initial={payload()} />, ['setup_guide:write']))
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark applied' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Mark applied' }).length).toBeGreaterThan(0)
  })

  it('a done applied step offers Clear instead of Mark applied', async () => {
    render(asAdmin(<SetupGuideClient initial={payload({ steps: [step(), step({ id: 's4', status: 'done', manual: { state: 'applied', applied_at: null, note: null } })] })} />, ['setup_guide:write']))
    expect(screen.getAllByRole('button', { name: 'Mark applied' })).toHaveLength(1)
    expect(screen.getByText('You applied')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ state: null })
  })

  it('toasts the server error when saving fails and does not reload', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Not allowed' }))
    render(asAdmin(<SetupGuideClient initial={payload()} />, ['setup_guide:write']))
    fireEvent.click(screen.getAllByRole('button', { name: 'Approved' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not allowed', 'error'))
    expect(fetchMock.mock.calls.filter(c => c[0] === '/api/admin/setup-guide').length).toBe(0)
  })

  it('hides the manual controls without setup_guide write access or when the payload is read-only', () => {
    const { unmount } = render(asMember(<SetupGuideClient initial={payload()} />, ['setup_guide:read']))
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
    unmount()
    render(asAdmin(<SetupGuideClient initial={payload({ canWrite: false })} />))
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
  })

  it('expands the how-to guide with steps, wait, and links', () => {
    const howTo = { before: ['GST number'], steps: ['Open the console', 'Paste the key'], wait: '2 days', links: [{ url: 'https://console.test', label: 'Console' }], notes: ['Use test mode first'] }
    render(asAdmin(<SetupGuideClient initial={payload({ steps: [step({ howTo })] })} />))
    fireEvent.click(screen.getByRole('button', { name: /How to do it/ }))
    expect(screen.getByText('GST number')).toBeInTheDocument()
    expect(screen.getByText('Open the console')).toBeInTheDocument()
    expect(screen.getByText('2 days')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Console' })).toHaveAttribute('href', 'https://console.test')
    expect(screen.getByText('Use test mode first')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /How to do it/ }))
    expect(screen.queryByText('Open the console')).not.toBeInTheDocument()
  })

  it('expands the own-credentials guide with register values and paste-back link', () => {
    const own = {
      summary: 'Bring your own Meta app', consoles: [{ url: 'https://dev.test', label: 'Dev console' }], create: ['An app'], steps: ['Create app'],
      register: [{ label: 'Redirect URL', value: 'https://store.test/cb', hint: 'Exact match' }], permissions: [{ name: 'pages_manage', why: 'post' }],
      approval: [{ step: 'App review', wait: '5 days' }], paste: { fields: ['App ID', 'Secret'], href: '/admin/settings/meta', label: 'Paste here', external: false },
      rejections: ['Missing privacy URL'], notes: ['Keep the secret safe'],
    }
    render(asAdmin(<SetupGuideClient initial={payload({ steps: [step({ ownCredentials: own })] })} />))
    fireEvent.click(screen.getByRole('button', { name: /Use your own credentials/ }))
    expect(screen.getByText('Bring your own Meta app')).toBeInTheDocument()
    expect(screen.getByText('https://store.test/cb')).toBeInTheDocument()
    expect(screen.getByText('Exact match')).toBeInTheDocument()
    expect(screen.getByText('pages_manage')).toBeInTheDocument()
    expect(screen.getByText(/App review/)).toHaveTextContent('5 days')
    expect(screen.getByText('App ID, Secret')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Paste here' })).toHaveAttribute('href', expect.stringContaining('/admin/settings/meta'))
    expect(screen.getByText('Missing privacy URL')).toBeInTheDocument()
  })

  it('has no platform tab for a store admin', () => {
    render(asAdmin(<SetupGuideClient initial={payload()} />))
    expect(screen.queryByRole('tab', { name: 'Platform apps' })).not.toBeInTheDocument()
  })

  it('the Platform apps tab loads platform items, missing keys and saves approvals', async () => {
    const platform = {
      counts: { total: 1, done: 0, in_progress: 0, needs_attention: 0, todo: 1, skipped: 0 },
      items: [{
        id: 'meta', title: 'Meta app review', why: 'WhatsApp', status: 'todo', manual: null, keys: { present: [], missing: ['META_SECRET'] },
        consoles: [], steps: ['Submit review'], register: [], approval: [{ step: 'Review', wait: '3 days' }], rejections: [],
      }],
    }
    fetchMock.mockImplementation(async (url: string) => (url === '/api/admin/setup-guide/platform' ? json(true, platform) : json(true, {})))
    render(asAdmin(<SetupGuideClient initial={payload({ platform: true })} />))
    fireEvent.click(screen.getByRole('tab', { name: 'Platform apps' }))
    expect(await screen.findByText('Meta app review')).toBeInTheDocument()
    expect(screen.getByText('Missing in this admin-service: META_SECRET')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /How to get it/ }))
    expect(screen.getByText('Submit review')).toBeInTheDocument()
    expect(screen.getByText('Review · 3 days')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(url).toBe('/api/admin/setup-guide/platform')
    expect(JSON.parse(init.body)).toEqual({ itemId: 'meta', state: 'approved' })
  })

  it('shows the load error on the Platform apps tab', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Platform only' }))
    render(asAdmin(<SetupGuideClient initial={payload({ platform: true })} />))
    fireEvent.click(screen.getByRole('tab', { name: 'Platform apps' }))
    expect(await screen.findByText('Platform only')).toBeInTheDocument()
  })
})
