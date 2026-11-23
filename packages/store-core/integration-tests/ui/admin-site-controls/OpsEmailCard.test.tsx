import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// OpsEmailCard: the daily ops email editor. Renders synchronously from `initial`; a debounced preview
// fetch and the Save/Test actions hit mocked endpoints. We assert render, recipient branches and save.

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import OpsEmailCard, { type OpsEmailAdmin } from '@/components/admin/site-controls/OpsEmailCard'
import { defaultOpsEmail } from '@/lib/shared/ops-email-config'

const admins: OpsEmailAdmin[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Asha', email: 'asha@shop.test', role: 'owner' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Ravi', email: 'ravi@shop.test', role: 'ops_manager' },
]

function routedFetch() {
  return vi.fn<(...a: any[]) => any>().mockImplementation((url: string) => {
    if (url.includes('/preview')) return Promise.resolve({ ok: true, json: async () => ({ subject: 'Ops briefing', html: '<p>hi</p>', note: '' }) })
    if (url.includes('/test')) return Promise.resolve({ ok: true, json: async () => ({ sentTo: 'asha@shop.test' }) })
    return Promise.resolve({ ok: true, json: async () => ({}) }) // save
  })
}

describe('OpsEmailCard', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
  })

  it('renders the heading, recipient select and the on/off toggle', () => {
    vi.stubGlobal('fetch', routedFetch())
    render(<OpsEmailCard initial={defaultOpsEmail(true)} admins={admins} lockedSections={{}} lockedAttachments={{}} />)
    expect(screen.getByRole('heading', { name: 'Daily ops email' })).toBeInTheDocument()
    // Enabled toggle shows its On label.
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    // Section labels from the default config render.
    expect(screen.getByText("Yesterday's numbers")).toBeInTheDocument()
  })

  it('shows the role checkboxes only in roles mode', () => {
    vi.stubGlobal('fetch', routedFetch())
    const cfg = { ...defaultOpsEmail(true), recipients: { mode: 'roles' as const, roles: [], adminIds: [], extra: [] } }
    render(<OpsEmailCard initial={cfg} admins={admins} lockedSections={{}} lockedAttachments={{}} />)
    // Roles derived from admins, title-cased.
    expect(screen.getByLabelText('Owner')).toBeInTheDocument()
    expect(screen.getByLabelText('Ops Manager')).toBeInTheDocument()
  })

  it('shows the admin checkboxes only in admins mode', () => {
    vi.stubGlobal('fetch', routedFetch())
    const cfg = { ...defaultOpsEmail(true), recipients: { mode: 'admins' as const, roles: [], adminIds: [], extra: [] } }
    render(<OpsEmailCard initial={cfg} admins={admins} lockedSections={{}} lockedAttachments={{}} />)
    expect(screen.getByText('asha@shop.test')).toBeInTheDocument()
    expect(screen.getByText('ravi@shop.test')).toBeInTheDocument()
  })

  it('starts with Save disabled (not dirty) and enables it after an edit', () => {
    vi.stubGlobal('fetch', routedFetch())
    render(<OpsEmailCard initial={defaultOpsEmail(true)} admins={admins} lockedSections={{}} lockedAttachments={{}} />)
    const save = screen.getByRole('button', { name: 'Saved' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/ops@yourstore.com/), { target: { value: 'extra@shop.test' } })
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  it('saves the draft (PATCH /api/admin/settings) and toasts on success', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<OpsEmailCard initial={defaultOpsEmail(true)} admins={admins} lockedSections={{}} lockedAttachments={{}} />)
    fireEvent.change(screen.getByPlaceholderText(/ops@yourstore.com/), { target: { value: 'extra@shop.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => c[0] === '/api/admin/settings' && c[1]?.method === 'PATCH')
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body).key).toBe('daily_ops_email')
    })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Daily email saved', 'success'))
  })

  it('sends a test and reports who it went to', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<OpsEmailCard initial={defaultOpsEmail(true)} admins={admins} lockedSections={{}} lockedAttachments={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send me a test' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Test sent to asha@shop.test', 'success'))
  })

  it('locks a section the plan does not include and shows the plan name', () => {
    vi.stubGlobal('fetch', routedFetch())
    render(
      <OpsEmailCard
        initial={defaultOpsEmail(true)}
        admins={admins}
        lockedSections={{ campaigns: 'Growth plan' }}
        lockedAttachments={{}}
      />
    )
    // The campaigns section checkbox is disabled and its lock label shows the plan.
    const campaignsBox = screen.getByRole('checkbox', { name: 'Campaigns' })
    expect(campaignsBox).toBeDisabled()
    expect(screen.getByText('Growth plan')).toBeInTheDocument()
  })

  it('disables every control for a read-only admin', () => {
    canWrite = false
    vi.stubGlobal('fetch', routedFetch())
    render(<OpsEmailCard initial={defaultOpsEmail(true)} admins={admins} lockedSections={{}} lockedAttachments={{}} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send me a test' })).toBeDisabled()
  })
})
