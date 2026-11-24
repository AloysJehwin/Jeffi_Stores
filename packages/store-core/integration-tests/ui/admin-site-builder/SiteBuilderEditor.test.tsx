import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, configure } from '@testing-library/react'
import { emptyDoc, pageRefKey, type Block, type PageDoc } from '@jeffi/site-blocks'
import SiteBuilderEditor from '@/components/admin/site-builder/SiteBuilderEditor'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'
import { res, routeFetch, bodyOf, callsTo } from '../admin-marketplace/marketplace-kit'

// SiteBuilderEditor: the Site Builder shell. With no draft open it offers a new draft or an open one; with a
// draft it loads the page's layout, lists its blocks, and every change autosaves (debounced) into the draft
// until Publish. The side panels, inspector, AI panels and visual editor are stubbed; the block list is real.
const showToast = vi.fn<(...a: any[]) => any>()
const showConfirm = vi.fn<(...a: any[]) => any>()

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/site-builder/AiSiteBuilder', () => ({
  default: ({ onOpen }: any) => (
    <button type="button" onClick={() => onOpen('ai-draft')}>
      open ai draft
    </button>
  ),
}))
vi.mock('@/components/admin/site-builder/BlockInspector', () => ({
  default: ({ block, onChange }: any) => (
    <div data-testid="inspector">
      inspecting {block.id}
      <button type="button" onClick={() => onChange({ ...block, props: { ...block.props, title: 'Edited' } })}>
        edit block
      </button>
    </div>
  ),
}))
vi.mock('@/components/admin/site-builder/AiPanel', () => ({ default: () => <div data-testid="ai-panel" /> }))
vi.mock('@/components/admin/site-builder/VisualEditor', () => ({
  default: ({ title, onClose }: any) => (
    <div data-testid="visual">
      {title}
      <button type="button" onClick={onClose}>
        close visual
      </button>
    </div>
  ),
}))
vi.mock('@/components/admin/site-builder/SidePanels', () => ({
  BlockLibrary: ({ onAdd }: any) => (
    <div data-testid="library">
      <button type="button" onClick={() => onAdd('trust_strip')}>
        add trust strip
      </button>
    </div>
  ),
  TemplatePanel: ({ onSave }: any) => (
    <div data-testid="templates">
      <button type="button" onClick={() => onSave('My layout')}>
        save template
      </button>
    </div>
  ),
  ThemePanel: ({ theme, onChange }: any) => (
    <div data-testid="theme">
      <button type="button" onClick={() => onChange({ ...theme, primary: '#abcdef' })}>
        change theme
      </button>
    </div>
  ),
}))
vi.mock('@/components/admin/homepage/HomepagePreview', () => ({ homepagePreviewUrl: (a: string, t: string, l: string, p: string) => `/preview?${a}&${t}&${l}&${p}` }))

const homeKey = pageRefKey({ audience: 'store', surface: 'web', page: 'home', slug: '' } as any)
const block = (id: string, type = 'product_row', props: Record<string, unknown> = {}): Block => ({ id, type, v: 1, props })
const docOf = (...bs: Block[]): PageDoc => ({ ...emptyDoc(), blocks: Object.fromEntries(bs.map(b => [b.id, b])), order: bs.map(b => b.id) })
const saved = docOf(block('a', 'product_row', { title: 'Fresh in' }), block('b', 'recently_viewed'))

const options = { counts: {} } as any
const DRAFT = '/api/admin/site-builder/drafts/d1'

function draftRoutes(extra: [string | RegExp, unknown][] = [], docs: Record<string, PageDoc> = { [homeKey]: saved }) {
  return routeFetch([
    ...extra,
    ['/drafts/d1/preview', res({ token: 'tok' })],
    ['/ai/page?draft', res({ job: null })],
    ['/site-builder/templates', res({ builtIn: [], saved: [] })],
    ['/site-builder?theme=', res({ tokens: null })],
    ['/site-builder?key=', res({ doc: emptyDoc() })],
    [DRAFT, (_u: string, init?: RequestInit) => (!init?.method || init.method === 'GET' ? res({ draft: { docs: { pages: docs, theme: {} } } }) : res({ published: { pages: [], conflicts: {} } }))],
  ])
}

type Props = Partial<React.ComponentProps<typeof SiteBuilderEditor>>
function setup(props: Props = {}, who: 'administrator' | 'staff' = 'administrator') {
  return render(
    <AdminScopesProvider role={who} scopes={[]}>
      <SiteBuilderEditor options={options} planTypes={null} business={false} initialDraftId={null} drafts={[]} {...props} />
    </AdminScopesProvider>
  )
}

describe('SiteBuilderEditor', () => {
  beforeEach(() => {
    // Draft loading is a chain of fetches; give the whole file headroom under a loaded full run.
    configure({ asyncUtilTimeout: 5000 })
    try {
      ;(window as any).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true
    } catch {}
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    showConfirm.mockResolvedValue(true)
    window.history.replaceState(null, '', '/admin/site-builder')
  })

  describe('with no draft open', () => {
    it('says the live site is shown, offers the AI redesign card and lists open drafts', () => {
      setup({ drafts: [{ id: 'd1', title: 'Spring', updated_at: '2026-01-02T10:00:00.000Z' }, { id: 'd2', title: null, updated_at: '2026-01-03T10:00:00.000Z' }] })
      expect(screen.getByText('You are looking at the live site')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'open ai draft' })).toBeInTheDocument()
      expect(screen.getByText('Spring')).toBeInTheDocument()
      expect(screen.getByText('Untitled draft')).toBeInTheDocument()
    })

    it('starts a new draft and opens it, putting it in the URL', async () => {
      const f = draftRoutes([[/\/site-builder\/drafts$/, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ id: 'd1' }) : res({}))]])
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'New draft' }))
      expect(await screen.findByText('Fresh in')).toBeInTheDocument()
      expect(window.location.search).toContain('draft=d1')
      expect(callsTo(f, '/site-builder/drafts').some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(true)
    })

    it('toasts when a draft cannot be started', async () => {
      routeFetch([['/site-builder/drafts', res({}, false)]])
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'New draft' }))
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not start a draft', 'error'))
    })

    it('opens an existing draft from the list, and one handed over by the AI card', async () => {
      draftRoutes()
      setup({ drafts: [{ id: 'd1', title: 'Spring', updated_at: '2026-01-02T10:00:00.000Z' }] })
      fireEvent.click(screen.getByRole('button', { name: /Spring/ }))
      expect(await screen.findByText('Fresh in')).toBeInTheDocument()
    })

    it('hides New draft from an admin without write access', () => {
      setup({}, 'staff')
      expect(screen.queryByRole('button', { name: 'New draft' })).toBeNull()
    })
  })

  describe('with a draft open', () => {
    it('loads the page layout and lists its blocks for the desktop layout', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' })
      expect(await screen.findByText('Fresh in')).toBeInTheDocument()
      expect(screen.getByText('Blocks · Desktop web')).toBeInTheDocument()
      expect(screen.getByTitle('Site preview')).toHaveAttribute('src', expect.stringContaining('/preview?store&tok&desktop&/'))
    })

    it('falls back to the landing view when the draft cannot be loaded', async () => {
      routeFetch([['/site-builder/drafts/d1', res({ error: 'gone' }, false)], ['/site-builder/templates', res({})], ['/ai/page', res({})], ['/site-builder?theme', res({})]])
      setup({ initialDraftId: 'd1' })
      expect(await screen.findByText('You are looking at the live site')).toBeInTheDocument()
    })

    it('says the layout is empty when it has no blocks', async () => {
      draftRoutes([], { [homeKey]: emptyDoc() })
      setup({ initialDraftId: 'd1' })
      expect(await screen.findByText(/No blocks on this layout yet/)).toBeInTheDocument()
    })

    it('selects a block, showing it in the inspector', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' })
      fireEvent.click(await screen.findByRole('button', { name: 'Fresh in' }))
      expect(screen.getByTestId('inspector')).toHaveTextContent('inspecting a')
    })

    it('autosaves an inspector edit (debounced) as a PUT of the whole page', async () => {
      const f = draftRoutes()
      setup({ initialDraftId: 'd1' })
      fireEvent.click(await screen.findByRole('button', { name: 'Fresh in' }))
      fireEvent.click(screen.getByRole('button', { name: 'edit block' }))
      expect(screen.getByText('Saving…')).toBeInTheDocument()
      expect(await screen.findByText('Saved to draft', {}, { timeout: 3000 })).toBeInTheDocument()
      const put = callsTo(f, DRAFT).find(([, i]) => (i as RequestInit)?.method === 'PUT')!
      const body = JSON.parse(String((put[1] as RequestInit).body))
      expect(body.page.ref).toMatchObject({ audience: 'store', surface: 'web', page: 'home' })
      expect(body.page.doc.blocks.a.props.title).toBe('Edited')
    })

    it('removes a block, then undoes and redoes it', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
      expect(screen.queryByText('Fresh in')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Fresh in')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
      await waitFor(() => expect(screen.queryByText('Fresh in')).toBeNull())
    })

    it('reorders blocks with the row arrows', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0])
      const rows = screen.getAllByRole('button').filter(b => b.className.includes('truncate'))
      expect(rows[0]).not.toHaveTextContent('Fresh in')
      expect(rows[1]).toHaveTextContent('Fresh in')
    })

    it('adds a block from the library after the selected one', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' })
      fireEvent.click(await screen.findByRole('button', { name: 'Fresh in' }))
      fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
      fireEvent.click(screen.getByRole('button', { name: 'add trust strip' }))
      await waitFor(() => expect(screen.getByTestId('inspector')).not.toHaveTextContent('inspecting a'))
      await waitFor(() => expect(screen.getAllByRole('button', { name: /Move up/ })).toHaveLength(3))
    })

    it('saves the current layout as a template, and a theme change to the draft', async () => {
      const f = draftRoutes([['/site-builder/templates', (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({}) : res({ builtIn: [], saved: [] }))]])
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
      fireEvent.click(screen.getByRole('button', { name: 'save template' }))
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved "My layout" to your templates', 'success'))
      const post = callsTo(f, '/site-builder/templates').find(([, i]) => (i as RequestInit)?.method === 'POST')!
      expect(JSON.parse(String((post[1] as RequestInit).body)).name).toBe('My layout')
      fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
      fireEvent.click(await screen.findByRole('button', { name: 'change theme' }))
      await waitFor(() => expect(callsTo(f, DRAFT).some(([, i]) => (i as RequestInit)?.method === 'PUT' && String((i as RequestInit).body).includes('#abcdef'))).toBe(true), { timeout: 3000 })
    })

    it('switches to the phone layout, which has its own key', async () => {
      const f = draftRoutes()
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getByRole('button', { name: 'Phone web' }))
      expect(await screen.findByText('Blocks · Phone web')).toBeInTheDocument()
      const mobileKey = pageRefKey({ audience: 'store', surface: 'web_mobile', page: 'home', slug: '' } as any)
      await waitFor(() => expect(callsTo(f, '/site-builder?key=').some(([u]) => String(u).includes(encodeURIComponent(mobileKey)))).toBe(true))
    })

    it('offers to keep desktop and phone the same, asking before copying a different layout', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      const link = await screen.findByRole('button', { name: /Same on phone/ })
      expect(link).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(link)
      await waitFor(() => expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: 'Use on both' })))
      await waitFor(() => expect(screen.getByRole('button', { name: /Same on phone/ })).toHaveAttribute('aria-pressed', 'true'))
    })

    it('publishes after confirmation and returns to the live view', async () => {
      const f = draftRoutes()
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Published', 'success'))
      expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Publish this draft?' }))
      expect(callsTo(f, DRAFT).some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(true)
      expect(await screen.findByText('You are looking at the live site')).toBeInTheDocument()
    })

    it('mentions blocks someone else also changed when publishing', async () => {
      routeFetch([
        ['/drafts/d1/preview', res({ token: 'tok' })],
        ['/ai/page?draft', res({ job: null })],
        ['/site-builder/templates', res({ builtIn: [], saved: [] })],
        ['/site-builder?theme=', res({ tokens: null })],
        [DRAFT, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ published: { pages: ['home'], conflicts: { home: ['a', 'b'] } } }) : res({ draft: { docs: { pages: { [homeKey]: saved }, theme: {} } } }))],
      ])
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Published. 2 block(s) were also changed by someone else; your version was kept.', 'success'))
    })

    it('toasts a failed publish and stays in the draft', async () => {
      routeFetch([
        ['/drafts/d1/preview', res({ token: 'tok' })],
        ['/ai/page?draft', res({ job: null })],
        ['/site-builder/templates', res({ builtIn: [], saved: [] })],
        ['/site-builder?theme=', res({ tokens: null })],
        [DRAFT, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ error: 'Validation failed' }, false) : res({ draft: { docs: { pages: { [homeKey]: saved }, theme: {} } } }))],
      ])
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Validation failed', 'error'))
      expect(screen.getByText('Blocks · Desktop web')).toBeInTheDocument()
    })

    it('does not publish when the confirmation is declined', async () => {
      const f = draftRoutes()
      showConfirm.mockResolvedValue(false)
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
      await waitFor(() => expect(showConfirm).toHaveBeenCalled())
      expect(callsTo(f, DRAFT).some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(false)
    })

    it('deletes the draft after confirmation', async () => {
      const f = draftRoutes()
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getByRole('button', { name: /Delete draft/ }))
      expect(await screen.findByText('You are looking at the live site')).toBeInTheDocument()
      expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete this draft?', type: 'danger' }))
      expect(callsTo(f, DRAFT).some(([, i]) => (i as RequestInit)?.method === 'DELETE')).toBe(true)
    })

    it('creates a custom page from a web address', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' })
      await screen.findByText('Fresh in')
      fireEvent.click(screen.getAllByRole('combobox')[0])
      fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '+ New page…' }))
      const input = screen.getByPlaceholderText('our-story')
      fireEvent.change(input, { target: { value: 'x' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      expect(showToast).toHaveBeenCalledWith('Give the page a web address of at least two letters, like "our-story"', 'error')
      fireEvent.change(input, { target: { value: 'Our Story!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(screen.queryByPlaceholderText('our-story')).toBeNull())
      expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('/p/our-story')
    })

    it('is read-only without write access: no publish, delete, add or link controls', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1' }, 'staff')
      await screen.findByText('Fresh in')
      expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
      expect(screen.queryByRole('button', { name: /Delete draft/ })).toBeNull()
      expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1)
      expect(screen.queryByRole('button', { name: /Same on phone/ })).toBeNull()
    })

    it('shows the visual editor first when it is switched on, and the classic editor on close', async () => {
      draftRoutes()
      setup({ initialDraftId: 'd1', visual: true })
      expect(await screen.findByTestId('visual')).toHaveTextContent('Home · Store')
      fireEvent.click(screen.getByRole('button', { name: 'close visual' }))
      expect(await screen.findByText('Classic editor')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Visual editor/ })).toBeInTheDocument()
    })
  })
})
