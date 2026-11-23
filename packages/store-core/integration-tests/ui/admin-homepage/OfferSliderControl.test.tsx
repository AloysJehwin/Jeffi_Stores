import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// OfferSliderControl: picks which offers become slider slides and orders them. Loads offers from the
// API on mount, shows chosen (checked, in saved order) first; toggling a checkbox / reordering persists
// through saveConfig. Contexts, AdminImage and the nested display editor are mocked; fetch is stubbed.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
const readOnlyRef = { value: false }
vi.mock('@/components/admin/homepage/HomepageLock', () => ({ useHomepageLock: () => ({ readOnly: readOnlyRef.value }) }))
vi.mock('@/components/admin/AdminImage', () => ({ default: () => <img alt="" /> }))
vi.mock('@/components/admin/homepage/OfferSlideDisplayEditor', () => ({
  default: ({ offer }: any) => <div data-testid="display-editor">editing {offer.id}</div>,
}))

import OfferSliderControl from '@/components/admin/homepage/OfferSliderControl'

const offer = (id: string, title: string, over: Record<string, any> = {}) => ({
  id,
  title,
  subtitle: null,
  badge_text: null,
  badge_color: null,
  cta_label: null,
  image_url: null,
  blurhash: null,
  is_active: true,
  product_count: 2,
  ...over,
})

const OFFERS = [offer('a', 'Alpha'), offer('b', 'Beta'), offer('c', 'Gamma')]

function stubFetch(offers = OFFERS) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ offers }) })) as any)
}

const section = (offerIds: string[] = []) => ({ id: 's1', type: 'offers', config: { offerIds } }) as any

describe('OfferSliderControl (render + branches + interaction)', () => {
  beforeEach(() => {
    readOnlyRef.value = false
    stubFetch()
  })

  it('shows the loading line first, then the offer rows', async () => {
    render(<OfferSliderControl section={section()} saveConfig={() => {}} />)
    expect(screen.getByText(/Loading offers/)).toBeInTheDocument()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('renders the empty-state when the API returns no offers', async () => {
    stubFetch([])
    render(<OfferSliderControl section={section()} saveConfig={() => {}} />)
    expect(await screen.findByText(/No offers yet/)).toBeInTheDocument()
  })

  it('toasts and leaves the loading gone when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any)
    render(<OfferSliderControl section={section()} saveConfig={() => {}} />)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not load offers', 'error'))
  })

  it('checking an offer persists it via saveConfig and reveals its card editor', async () => {
    const saveConfig = vi.fn<(...a: any[]) => any>()
    render(<OfferSliderControl section={section()} saveConfig={saveConfig} />)
    const cb = await screen.findByLabelText('Include Alpha in the slider')
    fireEvent.click(cb)
    expect(saveConfig).toHaveBeenLastCalledWith({ offerIds: ['a'] })
    // Checking opens the card display editor for that offer.
    expect(screen.getByTestId('display-editor')).toHaveTextContent('editing a')
  })

  it('unchecking a chosen offer removes it from the saved order', async () => {
    const saveConfig = vi.fn<(...a: any[]) => any>()
    render(<OfferSliderControl section={section(['a', 'b'])} saveConfig={saveConfig} />)
    const cb = await screen.findByLabelText('Include Alpha in the slider')
    expect(cb).toBeChecked()
    fireEvent.click(cb)
    expect(saveConfig).toHaveBeenLastCalledWith({ offerIds: ['b'] })
  })

  it('moving a chosen offer down swaps the saved order', async () => {
    const saveConfig = vi.fn<(...a: any[]) => any>()
    render(<OfferSliderControl section={section(['a', 'b'])} saveConfig={saveConfig} />)
    const down = await screen.findByLabelText('Move Alpha down')
    fireEvent.click(down)
    expect(saveConfig).toHaveBeenLastCalledWith({ offerIds: ['b', 'a'] })
  })

  it('disables the checkboxes when the draft is read-only', async () => {
    readOnlyRef.value = true
    render(<OfferSliderControl section={section()} saveConfig={() => {}} />)
    const cb = await screen.findByLabelText('Include Alpha in the slider')
    expect(cb).toBeDisabled()
  })
})
