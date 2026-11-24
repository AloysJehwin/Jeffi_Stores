import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => sp }))

const toastResult = vi.fn()
vi.mock('@/components/admin/kit', () => ({ useActionToast: () => ({ result: toastResult }) }))
vi.mock('@/components/admin/channels/ChannelPanels', () => ({
  ChannelAlerts: ({ channel }: any) => <div>alerts:{channel}</div>,
  JobRuns: ({ channel }: any) => <div>jobs:{channel}</div>,
}))
const apiMock = vi.fn()
vi.mock('@/components/admin/channels/ui', () => ({
  api: (...a: any[]) => apiMock(...a),
  Tabs: ({ tabs, value, onChange }: any) => (
    <div>
      {tabs.map((t: any) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('@admin/app/(admin)/admin/social-posts/Calendar', () => ({ default: () => <div>calendar-tab</div> }))
vi.mock('@admin/app/(admin)/admin/social-posts/Composer', () => ({
  default: ({ networks, goAccounts, onCreated }: any) => (
    <div>
      composer-tab:{networks?.length ?? 'null'}
      <button onClick={goAccounts}>go-accounts</button>
      <button onClick={onCreated}>created</button>
    </div>
  ),
}))
vi.mock('@admin/app/(admin)/admin/social-posts/Approvals', () => ({ default: ({ posts }: any) => <div>approvals-tab:{posts?.length}</div> }))
vi.mock('@admin/app/(admin)/admin/social-posts/Inbox', () => ({ default: () => <div>inbox-tab</div> }))
vi.mock('@admin/app/(admin)/admin/social-posts/Insights', () => ({ default: () => <div>insights-tab</div> }))
vi.mock('@admin/app/(admin)/admin/social-posts/Accounts', () => ({ default: ({ autoPick }: any) => <div>accounts-tab:{autoPick ?? '-'}</div> }))
vi.mock('@admin/app/(admin)/admin/social-posts/Library', () => ({ default: () => <div>library-tab</div> }))

import SocialPostsClient from '@admin/app/(admin)/admin/social-posts/SocialPostsClient'

const networks = [
  { network: 'facebook', status: 'pending' },
  { network: 'x', status: 'connected' },
]
const posts = [
  { id: 'p1', approval_status: 'pending', status: 'draft' },
  { id: 'p2', approval_status: 'pending', status: 'draft', group_id: 'g' },
  { id: 'p3', approval_status: 'pending', status: 'draft', group_id: 'g' },
  { id: 'p4', approval_status: 'pending', status: 'cancelled' },
]

describe('SocialPostsClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    window.history.replaceState(null, '', '/admin/social-posts')
    apiMock.mockImplementation(async (url: string) =>
      url.includes('networks') ? { ok: true, data: { networks } } : { ok: true, data: { posts } }
    )
  })

  it('loads networks and posts and shows the calendar with the tab strip', async () => {
    render(<SocialPostsClient canWrite canApprove />)
    expect(screen.getByText('calendar-tab')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Accounts (1)' })).toBeInTheDocument())
    expect(apiMock).toHaveBeenCalledWith('/api/admin/social/networks')
    expect(apiMock).toHaveBeenCalledWith('/api/admin/social-posts')
    expect(screen.getByRole('tab', { name: 'Compose' })).toBeInTheDocument()
    // p1 + group g (counted once); the cancelled one is excluded.
    expect(screen.getByRole('tab', { name: 'Approvals (2)' })).toBeInTheDocument()
  })

  it('hides Compose without write and Approvals without approve rights or waiting posts', async () => {
    apiMock.mockImplementation(async (url: string) => (url.includes('networks') ? { ok: true, data: { networks: [] } } : { ok: true, data: { posts: [] } }))
    render(<SocialPostsClient canWrite={false} canApprove={false} />)
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('tab', { name: 'Compose' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Approvals/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Inbox' })).toBeInTheDocument()
  })

  it('treats a failed load as empty lists', async () => {
    apiMock.mockResolvedValue({ ok: false })
    render(<SocialPostsClient canWrite canApprove />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Compose' }))
    await waitFor(() => expect(screen.getByText('composer-tab:0')).toBeInTheDocument())
  })

  it('switching tab pushes the URL; the composer can jump to Accounts', async () => {
    render(<SocialPostsClient canWrite canApprove />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Compose' }))
    expect(push).toHaveBeenCalledWith('/admin/social-posts?tab=compose', { scroll: false })
    fireEvent.click(screen.getByText('go-accounts'))
    expect(screen.getByText(/accounts-tab/)).toBeInTheDocument()
    expect(push).toHaveBeenLastCalledWith('/admin/social-posts?tab=accounts', { scroll: false })
  })

  it('reloads both lists when the composer reports a created post', async () => {
    render(<SocialPostsClient canWrite canApprove />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Compose' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByText('created'))
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(4))
  })

  it('renders the alerts tab with channel panels', async () => {
    sp = new URLSearchParams('tab=alerts')
    render(<SocialPostsClient canWrite canApprove />)
    expect(screen.getByText('alerts:social')).toBeInTheDocument()
    expect(screen.getByText('jobs:social')).toBeInTheDocument()
    await waitFor(() => expect(apiMock).toHaveBeenCalled())
  })

  it('an OAuth callback success lands on Accounts, toasts and preselects the network', async () => {
    sp = new URLSearchParams('connected=1&pick=1&network=facebook')
    render(<SocialPostsClient canWrite canApprove />)
    await waitFor(() => expect(screen.getByText('accounts-tab:facebook')).toBeInTheDocument())
    expect(toastResult).toHaveBeenCalledWith({ ok: true, text: 'Signed in. Choose where to post below.' })
  })

  it('an OAuth callback failure toasts the mapped error', async () => {
    sp = new URLSearchParams('connected=0&error=bad_state')
    render(<SocialPostsClient canWrite canApprove />)
    await waitFor(() => expect(toastResult).toHaveBeenCalledWith({ ok: false, text: 'The sign-in link expired. Try again.' }))
    expect(screen.getByText(/accounts-tab/)).toBeInTheDocument()
  })
})
