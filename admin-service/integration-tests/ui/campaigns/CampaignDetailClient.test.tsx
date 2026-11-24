import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => ({ whatsapp: false, push: false, sms: false, email: true }) }))
const lock = { readOnly: false, markLocked: vi.fn() }
vi.mock('@/hooks/useDraftLock', () => ({ useDraftLock: () => lock }))
const edit = { sessionId: 's1', save: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
vi.mock('@/hooks/useEditSession', () => ({ useEditSession: () => edit }))
const resnapshot = vi.fn<(...a: any[]) => Promise<void>>(async () => {})
vi.mock('@admin/app/(admin)/admin/campaigns/[kind]/edit/actions', () => ({ resnapshotCampaignSession: (...a: any[]) => resnapshot(...a) }))
vi.mock('@admin/app/(admin)/admin/campaigns/[kind]/CampaignLoading', () => ({ CampaignEditLoading: () => <div>campaign-loading</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/_components/campaign-presentation', () => ({ channelParamOff: () => false }))
vi.mock('@/lib/client/draft-lock-client', () => ({
  assertDraftResponse: async (res: any, msg: string) => { if (!res.ok) throw new Error(msg) },
  isDraftLockedError: () => false,
  lockHeaders: () => ({}),
}))
vi.mock('@/components/admin/kit', async orig => ({
  ...(await orig<any>()),
  DraftLockBanner: () => null,
  LockedFieldset: ({ children }: any) => <div>{children}</div>,
  FormFooter: ({ children, cancel, discard, draftBadge }: any) => (
    <div>{draftBadge}{children}{cancel && <button onClick={cancel}>Cancel</button>}{discard && <button onClick={discard}>Discard draft</button>}</div>
  ),
}))
vi.mock('@/components/admin/email-composer/EmailComposer', () => ({
  default: ({ value, onChange }: any) => <textarea aria-label="body" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/admin/email-composer/EmailBlockBuilder', () => ({ default: () => <div>block-builder</div> }))
vi.mock('@/components/admin/campaigns/CampaignVariables', () => ({ default: () => null }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/admin/campaigns/WhatsAppTemplateEditor', () => ({ default: () => null, WhatsAppPreview: () => null }))
vi.mock('@/components/admin/campaigns/PushEditor', () => ({ PushFields: () => null, PushPreview: () => null }))
vi.mock('@/components/admin/campaigns/DurationField', () => ({ default: () => null }))
vi.mock('@/components/admin/messaging-templates/LibraryTemplatePicker', () => ({ default: () => <div>library-picker</div> }))
vi.mock('@/components/admin/messaging-templates/LinkedTemplateEditor', () => ({ default: () => null }))
vi.mock('@/components/ui/Toggle', () => ({
  default: ({ checked, onChange, label }: any) => <input type="checkbox" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} />,
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label={`sel:${options[0].label}`} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import CampaignDetailClient from '@admin/app/(admin)/admin/campaigns/[kind]/CampaignDetailClient'

const campaign = (over: Record<string, unknown> = {}) => ({
  kind: 'abandoned_cart', name: 'Cart nudge', description: 'Reminds shoppers', enabled: true, delay_hours: 2, discount_percent: 10, coupon_id: null,
  scenario_kind: 'abandoned_cart', subject_template: 'Hi {firstName}', body_template: '<p>Your cart awaits</p>', last_run_at: null,
  parameters: { lookback_days: 14 }, draft_campaign_id: null, draft_fields: null, ...over,
})
const scenarios = [{
  kind: 'abandoned_cart', name: 'Abandoned cart', description: 'idle carts', default_parameters: { lookback_days: 7 },
  param_schema: { lookback_days: { type: 'integer', label: 'Lookback days', min: 1, max: 30, description: 'How far back' } },
}]
const coupons = [{ id: 'c1', code: 'SAVE10', discount_type: 'percentage', discount_value: 10, description: null }]
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 400) => ({ ok, status, json: async () => body })
let current: any

const draw = (scopes = ['campaigns:write'], kind = 'abandoned_cart') => render(asMember(<CampaignDetailClient kind={kind} />, scopes))
const patches = () => fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/draft') && c[1]?.method === 'PATCH')

describe('CampaignDetailClient', () => {
  beforeEach(() => {
    current = campaign()
    for (const m of [push, showToast, confirm, resnapshot, edit.save, edit.cancel, lock.markLocked]) m.mockReset()
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const m = init?.method || 'GET'
      if (url === '/api/admin/campaigns/coupons') return json(true, { coupons })
      if (url === '/api/admin/campaigns/scenarios') return json(true, { scenarios })
      if (/\/api\/admin\/campaigns\/[a-z_]+$/.test(url) && m === 'GET') return json(true, { campaign: current })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows a skeleton, then the campaign, locked scenario and scenario parameters', async () => {
    draw()
    expect(screen.getByText('campaign-loading')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Cart nudge' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/campaigns/abandoned_cart', { credentials: 'include' })
    expect(screen.getByText('Reminds shoppers')).toBeInTheDocument()
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByText('OVERRIDDEN')).toBeInTheDocument()
    expect(screen.getByText('Range: 1 to 30')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hi {firstName}')).toBeInTheDocument()
    expect(screen.getByTitle('Email preview')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'SAVE10 — 10% off' })).toBeInTheDocument()
  })

  it('shows not found when the campaign cannot be loaded', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('coupons') || url.includes('scenarios') ? json(true, {}) : json(false)))
    draw()
    expect(await screen.findByText('Campaign not found.')).toBeInTheDocument()
  })

  it('warns when a multi-product scenario body lacks the items token', async () => {
    draw()
    expect(await screen.findByText(/MUST include \{itemsHtml\}/)).toBeInTheDocument()
  })

  it('opening the editor starts a draft from the live values', async () => {
    draw()
    await screen.findByRole('heading', { name: 'Cart nudge' })
    await waitFor(() => expect(patches().length).toBe(1))
    expect(JSON.parse(patches()[0][1].body)).toMatchObject({ enabled: true, delay_hours: 2, subject_template: 'Hi {firstName}' })
  })

  it('does not restart a draft when one is already pending, and shows the pending badge', async () => {
    current = campaign({ draft_campaign_id: 'dc1', draft_fields: { delay_hours: 5, subject_template: 'Draft subject' } })
    draw()
    expect(await screen.findByDisplayValue('Draft subject')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    expect(screen.getByText('Draft pending')).toBeInTheDocument()
    expect(patches().length).toBe(0)
  })

  it('autosaves an edit to the draft after a pause', async () => {
    draw()
    await screen.findByRole('heading', { name: 'Cart nudge' })
    await waitFor(() => expect(patches().length).toBe(1))
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '6' } })
    await waitFor(() => expect(patches().length).toBe(2), { timeout: 3000 })
    expect(JSON.parse(patches()[1][1].body).delay_hours).toBe(6)
  })

  it('edits a scenario parameter and a boolean toggle into the draft body', async () => {
    draw()
    await screen.findByRole('heading', { name: 'Cart nudge' })
    fireEvent.change(screen.getByPlaceholderText('Default: 7'), { target: { value: '21' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Active' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Draft saved', 'success'))
    const last = patches().at(-1)!
    expect(JSON.parse(last[1].body)).toMatchObject({ enabled: false, parameters: { lookback_days: 21 } })
  })

  it('clearing a parameter removes its override', async () => {
    draw()
    await screen.findByText('OVERRIDDEN')
    fireEvent.change(screen.getByPlaceholderText('Default: 7'), { target: { value: '' } })
    expect(screen.queryByText('OVERRIDDEN')).not.toBeInTheDocument()
  })

  it('Save as Draft resnapshots the edit session and returns to the list', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns')))
    expect(resnapshot).toHaveBeenCalledWith('abandoned_cart')
    expect(showToast).toHaveBeenCalledWith('Draft saved', 'success')
  })

  it('toasts when saving the draft fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') return json(false)
      if (url.includes('coupons')) return json(true, { coupons })
      if (url.includes('scenarios')) return json(true, { scenarios })
      return json(true, { campaign: current })
    })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save draft', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('Update & Publish writes the draft, publishes, saves the session and opens the view page', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Update & Publish' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Campaign published', 'success'))
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/campaigns/abandoned_cart/publish' && c[1]?.method === 'POST')).toBe(true)
    expect(edit.save).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns/abandoned_cart/view'))
  })

  it('toasts the server error when publishing fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.endsWith('/publish')) return json(false, { error: 'Template invalid' })
      if (url.includes('coupons')) return json(true, { coupons })
      if (url.includes('scenarios')) return json(true, { scenarios })
      return json(true, { campaign: current })
    })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Update & Publish' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Template invalid', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('discards a pending draft after confirmation', async () => {
    current = campaign({ draft_campaign_id: 'dc1', draft_fields: { delay_hours: 5 } })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Draft discarded', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard draft?', variant: 'danger' }))
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/draft') && c[1]?.method === 'DELETE')).toBe(true)
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns'))
  })

  it('keeps the draft when the discard is declined', async () => {
    confirm.mockResolvedValue(false)
    current = campaign({ draft_campaign_id: 'dc1', draft_fields: { delay_hours: 5 } })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false)
  })

  it('Cancel confirms, cancels the edit session and goes back to the view page', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(edit.cancel).toHaveBeenCalled())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard changes?' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/campaigns/abandoned_cart/view'))
  })

  it('sends a test email to the typed address', async () => {
    draw()
    const btn = await screen.findByRole('button', { name: 'Send test' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('your@email.com for test send'), { target: { value: 'me@x.test' } })
    fireEvent.click(btn)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Test email sent to me@x.test', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/campaigns/abandoned_cart/test')!
    expect(JSON.parse(post[1].body)).toEqual({ email: 'me@x.test' })
  })

  it('AI regenerate replaces the subject and body and reports errors', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/campaigns/generate') return json(true, { subject_template: 'New subject', body_template: '<p>New body {itemsHtml}</p>' })
      if (url.includes('coupons')) return json(true, { coupons })
      if (url.includes('scenarios')) return json(true, { scenarios })
      return json(true, { campaign: current })
    })
    render(asAdmin(<CampaignDetailClient kind="abandoned_cart" />))
    await screen.findByRole('heading', { name: 'Cart nudge' })
    fireEvent.change(screen.getByPlaceholderText('Describe changes you want to the email…'), { target: { value: 'friendlier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Template updated', 'success'))
    expect(screen.getByDisplayValue('New subject')).toBeInTheDocument()
    expect(screen.getByLabelText('body')).toHaveValue('<p>New body {itemsHtml}</p>')
    expect(screen.queryByText(/MUST include/)).not.toBeInTheDocument()
  })

  it('shows the AI error from the server', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/campaigns/generate') return json(false, { error: 'Quota hit' })
      if (url.includes('coupons')) return json(true, { coupons })
      if (url.includes('scenarios')) return json(true, { scenarios })
      return json(true, { campaign: current })
    })
    render(asAdmin(<CampaignDetailClient kind="abandoned_cart" />))
    await screen.findByRole('heading', { name: 'Cart nudge' })
    fireEvent.change(screen.getByPlaceholderText('Describe changes you want to the email…'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Quota hit')).toBeInTheDocument()
  })

  it('switches between rich text and the block builder', async () => {
    draw()
    await screen.findByRole('heading', { name: 'Cart nudge' })
    fireEvent.click(screen.getByRole('button', { name: 'Block builder' }))
    expect(screen.getByText('block-builder')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }))
    expect(screen.getByLabelText('body')).toBeInTheDocument()
  })

  it('a custom campaign picks its scenario from a select; a linked email hides the inline subject', async () => {
    current = campaign({ kind: 'summer', name: 'Summer', scenario_kind: null, email_template_slug: 'welcome-email' })
    draw(['campaigns:write'], 'summer')
    await screen.findByRole('heading', { name: 'Summer' })
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
    expect(screen.getByLabelText('sel:None — manual / no automated trigger')).toBeInTheDocument()
    expect(screen.queryByText('Subject line')).not.toBeInTheDocument()
  })

  it('hides editing controls without write access', async () => {
    draw(['campaigns:read'])
    await screen.findByRole('heading', { name: 'Cart nudge' })
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send test' })).not.toBeInTheDocument()
    expect(screen.queryByText('Regenerate template with AI')).not.toBeInTheDocument()
  })
})
