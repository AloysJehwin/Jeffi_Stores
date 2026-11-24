import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import HomepageSectionManager, { applyDrop } from '@/components/admin/homepage/HomepageSectionManager'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'
import { SECTION_META, type HomepageSection } from '@/lib/catalog/homepage-sections'
import { makeSection } from './editor-kit'

// HomepageSectionManager: the homepage / listing-page layout editor. Sections are rows you toggle, edit, remove
// and re-order (rows may pair two sections side by side); every change PATCHes the draft and the page is
// told to refresh its "Draft pending" state. Heavy children are stubbed; fetch is stubbed.
const showToast = vi.fn<(...a: any[]) => any>()
const showConfirm = vi.fn<(...a: any[]) => any>()
const locked = vi.fn(async (_res: any) => false)
let readOnly = false

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/homepage/HomepageLock', () => ({
  useHomepageLock: () => ({ lock: null, lockId: 'd1', readOnly, headers: () => ({ 'x-draft': 'd1' }), locked }),
}))
vi.mock('@/components/admin/homepage/SectionConfigFields', () => ({
  default: ({ section, canWrite, half, onChange, onSave }: any) => (
    <div data-testid={`cfg-${section.id}`} data-can-write={String(canWrite)} data-half={half ?? ''}>
      <button type="button" onClick={() => onSave(section.id, { config: { limit: 3 } })}>
        save {section.id}
      </button>
      <button type="button" onClick={() => onChange(section.id, { title: 'Edited title' })}>
        edit {section.id}
      </button>
    </div>
  ),
}))
vi.mock('@/components/admin/homepage/SectionPreview', () => ({ default: ({ section }: any) => <div data-testid={`preview-${section.id}`} /> }))
vi.mock('@/components/admin/homepage/OfferSliderControl', () => ({ default: () => <div data-testid="offer-control" /> }))

const sec = (id: string, type: HomepageSection['type'], over: Partial<HomepageSection> = {}) => makeSection(type, { id, ...over })
const label = (t: HomepageSection['type']) => SECTION_META[t].label
const res = (body: unknown = {}, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => body })

function setup(props: Partial<React.ComponentProps<typeof HomepageSectionManager>> = {}, who: 'administrator' | 'staff' = 'administrator') {
  return render(
    <AdminScopesProvider role={who} scopes={[]}>
      <HomepageSectionManager initial={[]} {...props} />
    </AdminScopesProvider>
  )
}

const calls = (f: ReturnType<typeof vi.fn>, method: string, url?: string) =>
  f.mock.calls.filter(([u, i]: any[]) => (i?.method ?? 'GET') === method && (!url || String(u).includes(url)))

describe('HomepageSectionManager', () => {
  beforeEach(() => {
    readOnly = false
    showConfirm.mockResolvedValue(true)
    locked.mockResolvedValue(false)
  })

  it('lists only this layout’s sections, numbered, with type and hidden badges', () => {
    setup({
      initial: [sec('a', 'product_row', { title: 'Fresh in' }), sec('b', 'trust_strip', { is_active: false }), sec('c', 'recently_viewed', { surface: 'app' })],
    })
    expect(screen.getByText('Fresh in')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.queryByTestId('cfg-c')).toBeNull()
    expect(screen.getByText(/This is the Desktop web layout/)).toBeInTheDocument()
  })

  it('shows the empty homepage prompt and copies another device’s layout', async () => {
    const f = vi.fn(async () => res({}))
    vi.stubGlobal('fetch', f)
    try {
      vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    } catch {}
    setup()
    expect(screen.getByText(/shows the built-in default layout/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Start from Mobile web/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Copied the Mobile web layout to the draft', 'success'))
    const body = JSON.parse((f.mock.calls[0] as any)[1].body)
    expect(body).toMatchObject({ from: 'web_mobile', to: 'web', page: 'home', audience: 'store' })
    expect((f.mock.calls[0] as any)[1].headers).toMatchObject({ 'x-draft': 'd1' })
  })

  it('asks before replacing a layout that already has rows, then retries with replace', async () => {
    const f = vi.fn(async (_u: string, init?: any) => (JSON.parse(init.body).replace ? res({}) : res({}, false, 409)))
    vi.stubGlobal('fetch', f)
    try {
      vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    } catch {}
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Start from App/ }))
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Replace the Desktop web layout?', confirmText: 'Replace' }))
    expect(JSON.parse((f.mock.calls[1] as any)[1].body).replace).toBe(true)
  })

  it('toasts when copying fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: 'Nothing to copy' }, false)))
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Start from App/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nothing to copy', 'error'))
  })

  it('offers the business homepage a copy of the store homepage', () => {
    setup({ audience: 'business' })
    expect(screen.getByText('Business accounts see the store homepage')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start from the store homepage' })).toBeInTheDocument()
  })

  it('describes the empty state of a listing page differently', () => {
    setup({ page: 'products' })
    expect(screen.getByText(/choose after how many products it appears/)).toBeInTheDocument()
  })

  it('toggles a section’s visibility and saves it to the draft', async () => {
    const f = vi.fn(async () => res())
    vi.stubGlobal('fetch', f)
    setup({ initial: [sec('a', 'product_row')] })
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved to draft', 'success'))
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('/api/admin/homepage-sections/a')
    expect(init).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(init.body)).toEqual({ isActive: false })
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })

  it('wires the section editor’s changes to local state and the PATCH', async () => {
    const f = vi.fn(async () => res())
    vi.stubGlobal('fetch', f)
    setup({ initial: [sec('a', 'product_row', { title: 'Old' })] })
    fireEvent.click(screen.getByRole('button', { name: 'edit a' }))
    expect(screen.getByText('Edited title')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save a' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ config: { limit: 3 } })
  })

  it('toasts a failed save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, false)))
    setup({ initial: [sec('a', 'product_row')] })
    fireEvent.click(screen.getByRole('button', { name: 'save a' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save', 'error'))
  })

  it('adds a section from the picker and appends its row', async () => {
    const f = vi.fn(async () => res({ section: sec('new1', 'recently_viewed') }))
    vi.stubGlobal('fetch', f)
    setup({ initial: [sec('a', 'product_row')] })
    fireEvent.click(screen.getByRole('button', { name: /Add section/ }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label('recently_viewed')}`) }))
    await waitFor(() => expect(screen.getByTestId('cfg-new1')).toBeInTheDocument())
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ type: 'recently_viewed', page: 'home', audience: 'store', surface: 'web' })
    expect(showToast).toHaveBeenCalledWith('Section added to draft', 'success')
  })

  it('blocks singletons already on the page and types outside the plan', () => {
    setup({ initial: [sec('a', 'why_us')], planTypes: ['why_us', 'product_row'], upgrade: { recently_viewed: 'Pro' } as any })
    fireEvent.click(screen.getByRole('button', { name: /Add section/ }))
    const pick = (t: HomepageSection['type']) => screen.getAllByRole('button', { name: new RegExp(`^${label(t)}`) }).at(-1)!
    expect(pick('why_us')).toBeDisabled()
    expect(pick('why_us')).toHaveTextContent('Already on the page')
    expect(pick('recently_viewed')).toHaveTextContent('Comes with Pro')
    expect(pick('trust_strip')).toHaveTextContent('Not in your plan')
  })

  it('toasts when adding a section fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: 'Plan limit reached' }, false)))
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Add section/ }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label('recently_viewed')}`) }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Plan limit reached', 'error'))
  })

  it('removes a section after confirmation', async () => {
    const f = vi.fn(async () => res())
    vi.stubGlobal('fetch', f)
    setup({ initial: [sec('a', 'product_row', { title: 'Fresh in' })] })
    fireEvent.click(screen.getByRole('button', { name: /Remove section/ }))
    await waitFor(() => expect(screen.queryByTestId('cfg-a')).toBeNull())
    expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove section?', message: expect.stringContaining('"Fresh in"') }))
    expect(f).toHaveBeenCalledWith('/api/admin/homepage-sections/a', expect.objectContaining({ method: 'DELETE' }))
    expect(showToast).toHaveBeenCalledWith('Section removed from draft', 'success')
  })

  it('keeps the section when removal is declined or fails', async () => {
    const f = vi.fn(async () => res({}, false))
    vi.stubGlobal('fetch', f)
    setup({ initial: [sec('a', 'product_row')] })
    showConfirm.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: /Remove section/ }))
    await waitFor(() => expect(showConfirm).toHaveBeenCalled())
    expect(f).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Remove section/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to remove', 'error'))
    expect(screen.getByTestId('cfg-a')).toBeInTheDocument()
  })

  it('shows a plan note on a section the plan lacks, which can only be removed', () => {
    setup({ initial: [sec('a', 'why_us')], planTypes: ['product_row'], upgrade: { why_us: 'Pro' } as any })
    expect(screen.getByText('Not in your plan — hidden on the storefront')).toBeInTheDocument()
    expect(screen.getByText(/it comes with Pro/)).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByTestId('cfg-a')).toHaveAttribute('data-can-write', 'false')
    expect(screen.getByRole('button', { name: /Remove section/ })).toBeInTheDocument()
  })

  it('shows where a listing-page section sits between the products', () => {
    setup({ page: 'products', initial: [sec('a', 'recently_viewed', { page: 'products', config: { placement: { after: 8, every: 12 } } })] })
    expect(screen.getByText('After 8 · every 12')).toBeInTheDocument()
  })

  it('groups two sections into one row, which can be swapped and made full width', async () => {
    const f = vi.fn(async () => res())
    vi.stubGlobal('fetch', f)
    setup({
      initial: [sec('a', 'product_row', { config: { layout: { side: 'left' } } }), sec('b', 'trust_strip', { config: { layout: { side: 'right' } } })],
    })
    expect(screen.getByText('1a')).toBeInTheDocument()
    expect(screen.getByText('1b')).toBeInTheDocument()
    expect(screen.getByTestId('cfg-b')).toHaveAttribute('data-half', 'right')
    fireEvent.click(screen.getAllByTitle('Swap left and right')[0])
    await waitFor(() => expect(f).toHaveBeenCalled())
    let body = JSON.parse((f.mock.calls[0] as any)[1].body)
    expect(body.order).toEqual(['b', 'a'])
    expect(body.sides).toEqual({ a: 'right', b: 'left' })
    fireEvent.click(screen.getAllByTitle('Make both full width')[0])
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    body = JSON.parse((f.mock.calls[1] as any)[1].body)
    expect(body.sides).toEqual({ a: 'full', b: 'full' })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('rolls the layout back when saving it fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, false)))
    setup({ initial: [sec('a', 'product_row', { config: { layout: { side: 'left' } } }), sec('b', 'trust_strip', { config: { layout: { side: 'right' } } })] })
    fireEvent.click(screen.getAllByTitle('Make both full width')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save the layout', 'error'))
    expect(screen.getByText('1a')).toBeInTheDocument()
  })

  it('is read-only while someone else holds the draft', () => {
    readOnly = true
    setup({ initial: [sec('a', 'product_row')] })
    expect(screen.queryByRole('button', { name: /Add section/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove section/ })).toBeNull()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: `Move ${label('product_row')}` })).toBeDisabled()
  })

  it('opens every row and hosts the hero editor and offer control when always expanded', () => {
    setup({ alwaysExpanded: true, heroEditor: <div>hero slides here</div>, initial: [sec('h', 'hero'), sec('o', 'offer_slider')] })
    expect(screen.getByText('hero slides here')).toBeInTheDocument()
    expect(screen.getByTestId('offer-control')).toBeInTheDocument()
    expect(screen.getByTestId('preview-h')).toBeInTheDocument()
  })

  it('collapses a row until its header is clicked', () => {
    setup({ initial: [sec('a', 'product_row')] })
    expect(screen.queryByTestId('preview-a')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByTestId('preview-a')).toBeInTheDocument()
  })
})

describe('applyDrop', () => {
  const s = (id: string, side?: 'left' | 'right') => sec(id, 'product_row', side ? { config: { layout: { side } } } : {})
  const ids = (list: HomepageSection[] | null) => list?.map(x => x.id)
  const sideOf = (x: HomepageSection) => (x.config as any).layout?.side ?? 'full'

  it('moves a section before another full width', () => {
    const next = applyDrop([s('a'), s('b'), s('c')], 'c', { kind: 'gap', before: 'a' })
    expect(ids(next)).toEqual(['c', 'a', 'b'])
  })

  it('moves a section to the end', () => {
    expect(ids(applyDrop([s('a'), s('b')], 'a', { kind: 'gap', before: null }))).toEqual(['b', 'a'])
  })

  it('pairs a section beside another, left or right', () => {
    const next = applyDrop([s('a'), s('b'), s('c')], 'c', { kind: 'slot', target: 'a', side: 'right' })!
    expect(ids(next)).toEqual(['a', 'c', 'b'])
    expect(sideOf(next[0])).toBe('left')
    expect(sideOf(next[1])).toBe('right')
    const flipped = applyDrop([s('a'), s('b')], 'b', { kind: 'slot', target: 'a', side: 'left' })!
    expect(ids(flipped)).toEqual(['b', 'a'])
    expect(sideOf(flipped[0])).toBe('left')
    expect(sideOf(flipped[1])).toBe('right')
  })

  it('sends the dragged section’s old partner back to full width', () => {
    const next = applyDrop([s('a', 'left'), s('b', 'right'), s('c')], 'a', { kind: 'gap', before: 'c' })!
    expect(ids(next)).toEqual(['b', 'a', 'c'])
    expect(sideOf(next[0])).toBe('full')
    expect(sideOf(next[1])).toBe('full')
  })

  it('refuses an unknown section or target', () => {
    expect(applyDrop([s('a')], 'zzz', { kind: 'gap', before: null })).toBeNull()
    expect(applyDrop([s('a'), s('b')], 'a', { kind: 'gap', before: 'nope' })).toBeNull()
    expect(applyDrop([s('a'), s('b')], 'a', { kind: 'slot', target: 'nope', side: 'left' })).toBeNull()
  })
})
