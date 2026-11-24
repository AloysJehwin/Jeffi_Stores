import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
const lock = { readOnly: false, markLocked: vi.fn() }
vi.mock('@/hooks/useDraftLock', () => ({ useDraftLock: () => lock }))
const flush = vi.fn(async () => {})
const trigger = vi.fn()
vi.mock('@/hooks/useAutosaveDraft', async orig => ({ ...(await orig<any>()), useAutosaveDraft: () => ({ trigger, flush, status: 'idle' }) }))
vi.mock('@/components/admin/kit/draft-lock', () => ({
  DraftLockBanner: () => <div>lock-banner</div>,
  LockedFieldset: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/lib/client/draft-lock-client', () => ({ assertDraftResponse: vi.fn(async () => {}), lockHeaders: () => ({}) }))

import NewScenarioClient from '@admin/app/(admin)/admin/campaigns/scenarios/new/NewScenarioClient'

const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const generated = {
  sql: 'SELECT id FROM users', product_sql: 'SELECT name FROM products', explanation: 'Buyers who stopped',
  validation: { ok: true, tablesReferenced: ['users'] }, productValidation: { ok: true },
  name: 'One-time buyers', kind: 'one_time', description: 'Bought once',
}
const dry = { count: 1234, sample: ['u1', 'u2'], productCount: 3, productSample: [{ name: 'Drill', price: 1999.4, image_url: null }], elapsedMs: 42 }

function routes(over: Record<string, any> = {}) {
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    const key = `${init?.method || 'GET'} ${url}`
    if (key in over) return over[key]
    if (url.endsWith('/generate')) return json(true, generated)
    if (url.endsWith('/dry-run')) return json(true, dry)
    if (url.endsWith('/create')) return json(true, { kind: 'one_time' })
    if (url.endsWith('/drafts') && init?.method === 'POST') return json(true, { id: 'd1' })
    return json(true, {})
  })
}
async function toReview() {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Customers who placed/), { target: { value: 'one time buyers' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate SQL with AI' }))
  await screen.findByText('Review the generated SQL')
}

describe('NewScenarioClient', () => {
  beforeEach(() => {
    for (const m of [push, replace, showToast, confirm, flush, trigger]) m.mockReset()
    flush.mockResolvedValue(undefined)
    fetchMock.mockReset()
    routes()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('starts on the describe step with generation disabled until a prompt is typed', () => {
    render(asAdmin(<NewScenarioClient />))
    expect(screen.getByText('Describe the audience')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate SQL with AI' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).not.toBeInTheDocument()
  })

  it('generates SQL, shows validation and the product query, and prefills name fields', async () => {
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/scenarios/generate'))!
    expect(JSON.parse(call[1].body)).toEqual({ prompt: 'one time buyers' })
    expect(screen.getByText('Buyers who stopped')).toBeInTheDocument()
    expect(screen.getByText('Safety filter passed')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByDisplayValue('SELECT name FROM products')).toBeInTheDocument()
    expect(screen.getByText('Product query passed safety check')).toBeInTheDocument()
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns/scenarios/new?draft=d1'), { scroll: false }))
  })

  it('shows the generation error from the server and stays on describe', async () => {
    routes({ 'POST /api/admin/campaigns/scenarios/generate': json(false, { error: 'Model busy' }) })
    render(asAdmin(<NewScenarioClient />))
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Customers who placed/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate SQL with AI' }))
    expect(await screen.findByText('Model busy')).toBeInTheDocument()
    expect(screen.getByText('Describe the audience')).toBeInTheDocument()
  })

  it('blocks the dry run when the safety filter rejected the SQL', async () => {
    routes({ 'POST /api/admin/campaigns/scenarios/generate': json(true, { ...generated, validation: { ok: false, reason: 'DELETE not allowed', matched: 'delete' } }) })
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    expect(screen.getByText('Rejected by safety filter')).toBeInTheDocument()
    expect(screen.getByText(/DELETE not allowed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run dry run' })).toBeDisabled()
  })

  it('runs the dry run, shows counts and samples, then saves the scenario with a slugged kind', async () => {
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Run dry run' }))
    expect(await screen.findByText('Name and save')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('(42ms)')).toBeInTheDocument()
    expect(screen.getByText('u1')).toBeInTheDocument()
    expect(screen.getByText('Drill')).toBeInTheDocument()
    expect(screen.getByText('₹1,999')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. One-time buyers'), { target: { value: 'Big Spenders!' } })
    fireEvent.change(screen.getByPlaceholderText('big_spenders'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save scenario (paused)' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns/scenarios')))
    const post = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/scenarios/create'))!
    expect(JSON.parse(post[1].body)).toMatchObject({ name: 'Big Spenders!', kind: 'big_spenders', generated_sql: 'SELECT id FROM users', dry_run_count: 1234, draft_id: 'd1', product_sql: 'SELECT name FROM products' })
    expect(showToast).toHaveBeenCalledWith('Scenario "one_time" created (paused). Enable it from the list to activate.', 'success')
  })

  it('derives the kind from the name when the kind field is blank', async () => {
    routes({ 'POST /api/admin/campaigns/scenarios/generate': json(true, { ...generated, name: '', kind: '', description: '' }) })
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Run dry run' }))
    await screen.findByText('Name and save')
    fireEvent.change(screen.getByPlaceholderText('e.g. One-time buyers'), { target: { value: 'Big Spenders!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save scenario (paused)' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/scenarios/create'))).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find(c => String(c[0]).endsWith('/scenarios/create'))![1].body).kind).toBe('big_spenders')
  })

  it('toasts the server error when the dry run fails and when saving fails', async () => {
    routes({ 'POST /api/admin/campaigns/scenarios/dry-run': json(false, { error: 'Query timed out' }) })
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Run dry run' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Query timed out', 'error'))
    expect(screen.queryByText('Name and save')).not.toBeInTheDocument()
  })

  it('shows the save error and stays on the page', async () => {
    routes({ 'POST /api/admin/campaigns/scenarios/create': json(false, { error: 'Kind taken' }) })
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Run dry run' }))
    await screen.findByText('Name and save')
    fireEvent.click(screen.getByRole('button', { name: 'Save scenario (paused)' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Kind taken', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('Back returns to the previous step', async () => {
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Describe the audience')).toBeInTheDocument()
  })

  it('Save as Draft stores the draft and returns to the drafts list', async () => {
    render(asAdmin(<NewScenarioClient />))
    await toReview()
    await waitFor(() => expect(replace).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns?tab=drafts')))
    expect(flush).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Draft saved', 'success')
  })

  it('resumes a draft from ?draft= at the saved step with its fields', async () => {
    routes({
      'GET /api/admin/campaigns/scenarios/drafts/d9': json(true, { draft: { fields: { step: 'review_sql', sql: 'SELECT 1', explanation: 'Resumed text', aiPrompt: 'p', validation: { ok: true }, name: 'Saved name' } } }),
    })
    render(asAdmin(<NewScenarioClient initialDraftId="d9" />))
    expect(await screen.findByText('Resumed text')).toBeInTheDocument()
    expect(screen.getByDisplayValue('SELECT 1')).toBeInTheDocument()
    expect(screen.getByText('lock-banner')).toBeInTheDocument()
    expect(screen.getByText(/New scenario · Saved name \(draft\)/)).toBeInTheDocument()
  })

  it('redirects to the drafts tab when the draft cannot be opened', async () => {
    routes({ 'GET /api/admin/campaigns/scenarios/drafts/bad': json(false, { error: 'Gone' }) })
    render(asAdmin(<NewScenarioClient initialDraftId="bad" />))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Gone', 'error'))
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns?tab=drafts'))
  })

  it('discards a draft after confirmation and deletes it', async () => {
    confirm.mockResolvedValue(true)
    routes({ 'GET /api/admin/campaigns/scenarios/drafts/d9': json(true, { draft: { fields: { step: 'review_sql', sql: 'SELECT 1' } } }) })
    render(asAdmin(<NewScenarioClient initialDraftId="d9" />))
    await screen.findByDisplayValue('SELECT 1')
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Scenario draft discarded', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard scenario draft', variant: 'danger' }))
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/campaigns/scenarios/drafts/d9' && c[1]?.method === 'DELETE')).toBe(true)
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns/scenarios'))
  })

  it('hides the action buttons without write access', () => {
    render(asMember(<NewScenarioClient />, ['campaigns:read']))
    expect(screen.queryByRole('button', { name: 'Generate SQL with AI' })).not.toBeInTheDocument()
  })
})
