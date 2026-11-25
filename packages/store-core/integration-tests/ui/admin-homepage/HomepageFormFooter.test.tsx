import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import HomepageFormFooter from '@/components/admin/homepage/HomepageFormFooter'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'
import type { HomepageDraftSummary } from '@/lib/catalog/homepage-draft'
import { HOMEPAGE_DRAFT_CHANGED } from '@/components/admin/homepage/draft-events'

// HomepageFormFooter: the homepage editor's action bar. Section changes autosave elsewhere; this bar shows the
// "Draft pending" state, and owns Publish (with merge conflicts), Discard, Save as Draft and Cancel.
const showToast = vi.fn<(...a: any[]) => any>()
const showConfirm = vi.fn<(...a: any[]) => any>()
const push = vi.fn()
const refresh = vi.fn()
const editSave = vi.fn(async () => true)
const editCancel = vi.fn(async () => true)
let sessionId: string | null = null
const locked = vi.fn(async (_res: any) => false)

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm }), useToastOptional: () => ({ showToast }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/hooks/useEditSession', () => ({ useEditSession: () => ({ sessionId, save: editSave, cancel: editCancel }) }))
vi.mock('@/components/admin/homepage/HomepageLock', () => ({
  useHomepageLock: () => ({ lock: null, lockId: 'd1', readOnly: false, headers: () => ({ 'x-lock': 'd1' }), locked }),
}))

const diff = (over: Record<string, unknown> = {}) => ({ added: 0, removed: 0, edited: 0, reordered: false, ...over })
const summary = (over: Partial<HomepageDraftSummary> = {}): HomepageDraftSummary => ({ hasDraft: true, title: null, updatedAt: null, updatedBy: null, sections: diff({ edited: 2 }), slides: diff(), ...over }) as any
const jsonRes = (body: unknown, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => body })

function setup(over: { summary?: HomepageDraftSummary; resnapshot?: () => Promise<void>; who?: 'administrator' | 'staff' } = {}) {
  const resnapshotAction = vi.fn(over.resnapshot ?? (async () => {}))
  render(
    <AdminScopesProvider role={over.who ?? 'administrator'} scopes={[]}>
      <HomepageFormFooter draftId="d1" initialSummary={over.summary ?? summary()} cancelHref="/admin/settings" liveHref="/admin/homepage" resnapshotAction={resnapshotAction} />
    </AdminScopesProvider>
  )
  return { resnapshotAction }
}

describe('HomepageFormFooter', () => {
  beforeEach(() => {
    sessionId = null
    showConfirm.mockResolvedValue(true)
    locked.mockResolvedValue(false)
  })

  it('shows Draft pending and enables Save / Publish when the draft has changes', () => {
    setup()
    expect(screen.getByText('Draft pending')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/admin/settings')
  })

  it('disables Save / Publish and hides Discard when nothing changed', () => {
    setup({ summary: summary({ sections: diff(), slides: diff() }) })
    expect(screen.queryByText('Draft pending')).toBeNull()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeDisabled()
  })

  it('hides Save / Publish from an admin without write access', () => {
    setup({ who: 'staff' })
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).toBeNull()
  })

  it('publishes after confirmation, then goes to the live homepage', async () => {
    const f = vi.fn(async () => jsonRes({ ok: true }))
    vi.stubGlobal('fetch', f)
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/homepage'))
    expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Publish this draft?' }))
    expect(f).toHaveBeenCalledWith('/api/admin/homepage-draft/publish?draft=d1', expect.objectContaining({ method: 'POST', body: '{}' }))
    expect((f.mock.calls[0] as any)[1].headers).toMatchObject({ 'Content-Type': 'application/json', 'x-lock': 'd1' })
    expect(showToast).toHaveBeenCalledWith('Published - the homepage is live', 'success')
    expect(refresh).toHaveBeenCalled()
  })

  it('does nothing when the publish confirmation is declined', async () => {
    showConfirm.mockResolvedValue(false)
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(showConfirm).toHaveBeenCalled())
    expect(f).not.toHaveBeenCalled()
  })

  it('opens the merge dialog on a publish conflict and publishes when it is resolved', async () => {
    const conflict = { path: 'sections.a.title', label: 'Heading', base: 'Old', theirs: 'Theirs', mine: 'Mine' }
    let n = 0
    const f = vi.fn(async () => (n++ === 0 ? jsonRes({ code: 'DRAFT_CONFLICT', conflicts: [conflict] }, false, 409) : jsonRes({ ok: true })))
    vi.stubGlobal('fetch', f)
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Live changed while you edited')).toBeInTheDocument()
    expect(within(dialog).getByText('Heading')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep all mine' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/homepage'))
    expect(JSON.parse((f.mock.calls[1] as any)[1].body)).toEqual({ resolutions: { 'sections.a.title': 'mine' } })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('toasts a publish failure and stays put', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: 'Validation failed' }, false)))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Validation failed', 'error'))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled()
  })

  it('stays put when the draft is locked by someone else', async () => {
    locked.mockResolvedValue(true)
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({}, false, 423)))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(locked).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('saves as draft by resnapshotting the session', async () => {
    const { resnapshotAction } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Draft saved - Cancel will revert to this point', 'success'))
    expect(resnapshotAction).toHaveBeenCalledWith('d1')
  })

  it('toasts when saving as draft fails', async () => {
    setup({ resnapshot: async () => { throw new Error('x') } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save draft', 'error'))
  })

  it('discards the draft after confirmation and returns to the live view', async () => {
    const f = vi.fn(async () => jsonRes({ ok: true }))
    vi.stubGlobal('fetch', f)
    sessionId = 's1'
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/homepage'))
    expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this draft?', type: 'danger' }))
    expect(f).toHaveBeenCalledWith('/api/admin/homepage-draft', expect.objectContaining({ method: 'DELETE' }))
    expect(editSave).toHaveBeenCalled()
  })

  it('toasts when discarding fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({}, false)))
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to discard the draft', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('flashes Saved on an autosave and refreshes the summary', async () => {
    const f = vi.fn(async () => jsonRes(summary({ sections: diff({ added: 3 }) })))
    vi.stubGlobal('fetch', f)
    setup({ summary: summary({ sections: diff(), slides: diff() }) })
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    act(() => {
      window.dispatchEvent(new Event(HOMEPAGE_DRAFT_CHANGED))
    })
    expect(await screen.findByText(/saved/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled())
    expect(f).toHaveBeenCalledWith('/api/admin/homepage-draft?draft=d1', expect.objectContaining({ cache: 'no-store' }))
  })

  it('offers Cancel as a rollback when an edit session is open', () => {
    sessionId = 's1'
    setup()
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
  })
})
