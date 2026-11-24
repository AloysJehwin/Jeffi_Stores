import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => true,
  useCanUseAi: () => true,
  useHasScope: () => true,
}))

import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { AdsManageProvider } from '@admin/app/(admin)/admin/google-ads/_components/ManageContext'
import { NewCampaignButton } from '@admin/app/(admin)/admin/google-ads/_components/CampaignWizard'
import EcomPresets from '@admin/app/(admin)/admin/google-ads/_components/wizard/EcomPresets'
import { draftFromPreset, newDraft, toSpec } from '@admin/app/(admin)/admin/google-ads/_components/wizard/draft'
import { CampaignSpecSchema, specProblems } from '@/lib/google-ads/campaign-spec'
import { buildEcomPresets } from '@/lib/google-ads/ecom-presets'

const PRESETS = buildEcomPresets('https://ecom.jeffistores.in', 'Jeffi Stores')
const BOOTSTRAP = {
  store: { name: 'Jeffi Stores', baseUrl: 'https://jeffistores.in', logoUrl: null, currency: 'INR' },
  budget: { revenue30d: 0, orders30d: 0, dailyRevenue: 0, suggestedDaily: 200 },
  shipTo: { states: [], allIndia: true },
  categories: [],
  brands: [],
  labels: { margin: {}, velocity: {}, stock: {} },
  images: [],
  merchantConnected: true,
  facts: [],
}

const fetchMock = vi.fn()
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
const answer = (bootstrap: object) =>
  fetchMock.mockImplementation((url: string) => (String(url).includes('/manage') ? ok(bootstrap) : ok({})))
const posts = () => fetchMock.mock.calls.filter(c => c[1]?.method === 'POST').map(c => ({ url: String(c[0]), body: JSON.parse(c[1].body) }))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wizard = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <AdsManageProvider currency="INR" onChanged={vi.fn()}>
          <NewCampaignButton onCreated={vi.fn()} />
        </AdsManageProvider>
      </ConfirmProvider>
    </ToastProvider>
  )

describe('EcomPresets', () => {
  it('lists both presets and hands back the one picked', () => {
    const onPick = vi.fn()
    render(<EcomPresets presets={PRESETS} onPick={onPick} />)
    expect(screen.getByText('Online store for your business')).toBeTruthy()
    fireEvent.click(screen.getByText('Free business website (Showcase)'))
    expect(onPick).toHaveBeenCalledWith(PRESETS[1])
  })

  it('renders nothing without presets', () => {
    const { container } = render(<EcomPresets presets={[]} onPick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('draftFromPreset', () => {
  it.each(PRESETS.map(p => [p.id, p] as const))('%s fills a draft that is a valid Search spec', (_id, p) => {
    const d = draftFromPreset(p, BOOTSTRAP as any)
    expect(d).toMatchObject({ type: 'SEARCH', name: p.name, dailyBudget: String(p.dailyBudget) })
    const spec = toSpec(d, null)
    expect(CampaignSpecSchema.safeParse(spec).success).toBe(true)
    expect(specProblems(spec, '2026-01-01')).toEqual([])
    expect(spec.adGroups![0].ad.finalUrl).toBe(p.finalUrl)
    expect(spec.adGroups![0].keywords).toEqual(p.keywords)
    expect(spec.adGroups![0].negatives!.length).toBe(p.negatives.length)
    expect(spec.status).toBe('PAUSED')
  })

  it('leaves an ordinary draft untouched', () => {
    expect(newDraft(BOOTSTRAP as any).adGroups[0].finalUrl).toBe('https://jeffistores.in')
  })
})

describe('wizard gating', () => {
  it('shows "Promote ecom" and fills the wizard when the server sent presets (platform flagship)', async () => {
    answer({ ...BOOTSTRAP, ecomPresets: PRESETS })
    wizard()
    fireEvent.click(screen.getByLabelText('New campaign'))
    await waitFor(() => expect(screen.getByLabelText('Promote ecom')).toBeTruthy())
    fireEvent.click(screen.getByText('Online store for your business'))
    await waitFor(() => expect((screen.getByDisplayValue('Ecom - Online store') as HTMLInputElement).value).toBe('Ecom - Online store'))
    expect(posts()).toEqual([])
  })

  it('shows nothing of the kind for a store or a non-platform connection', async () => {
    answer(BOOTSTRAP)
    wizard()
    fireEvent.click(screen.getByLabelText('New campaign'))
    await waitFor(() => expect(screen.getByText('Standard Shopping')).toBeTruthy())
    expect(screen.queryByLabelText('Promote ecom')).toBeNull()
  })
})
