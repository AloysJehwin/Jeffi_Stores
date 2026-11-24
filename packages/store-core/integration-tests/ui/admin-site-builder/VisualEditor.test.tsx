import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { emptyDoc, pageRefKey, type PageRef } from '@jeffi/site-blocks'
import VisualEditor from '@/components/admin/site-builder/VisualEditor'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'
import { res, routeFetch, bodyOf, callsTo } from '../admin-marketplace/marketplace-kit'

// VisualEditor: the Site Builder's host for the visual editor. The editor itself is stubbed so the host it is
// handed (load / save / publish / convert / AI) can be exercised against a stubbed fetch.
let host: any
vi.mock('@/components/site-editor/SiteEditor', () => ({
  default: (p: any) => {
    host = p.host
    return <div data-testid="editor">{p.host.title}</div>
  },
}))
vi.mock('@/components/admin/site-builder/BlockInspector', () => ({ default: () => <div data-testid="inspector" /> }))
vi.mock('@/components/admin/media/MediaField', () => ({ default: () => <div /> }))

const ref: PageRef = { audience: 'store', surface: 'app', page: 'home' } as any
const web = { ...ref, surface: 'web' } as PageRef
const KEY = encodeURIComponent(pageRefKey(web))
const doc = emptyDoc()

function setup(over: Partial<React.ComponentProps<typeof VisualEditor>> = {}, who: 'administrator' | 'staff' = 'administrator') {
  const onClose = vi.fn()
  const onPublish = vi.fn(async () => {})
  const utils = render(
    <AdminScopesProvider role={who} scopes={who === 'staff' ? ['settings:write'] : []}>
      <VisualEditor draftId="d1" pageRef={ref} title="Home" previewUrl="/preview" canWrite theme={null} onClose={onClose} onPublish={onPublish} {...over} />
    </AdminScopesProvider>
  )
  return { onClose, onPublish, ...utils }
}

describe('VisualEditor', () => {
  beforeEach(() => {
    host = undefined
  })

  it('hands the editor its title, preview and labels, always for the desktop web layout', () => {
    const { onClose, onPublish } = setup()
    expect(screen.getByTestId('editor')).toHaveTextContent('Home')
    expect(host).toMatchObject({ title: 'Home', previewUrl: '/preview', canWrite: true, closeLabel: 'Classic editor' })
    expect(host.onClose).toBe(onClose)
    expect(host.publish).toBe(onPublish)
    expect(host.blockLabel('product_row')).toBeTruthy()
    expect(host.blockLabel('mystery')).toBe('mystery')
    expect(host.blockLocked('mystery')).toBe(false)
  })

  it('is writable only with both the caller’s say-so and the settings scope', () => {
    setup({ canWrite: false })
    expect(host.canWrite).toBe(false)
    setup({}, 'staff')
    expect(host.canWrite).toBe(true)
  })

  it('is read-only for an admin without the settings scope', () => {
    render(
      <AdminScopesProvider role="staff" scopes={[]}>
        <VisualEditor draftId="d1" pageRef={ref} title="Home" previewUrl={null} canWrite theme={null} onClose={() => {}} onPublish={async () => {}} />
      </AdminScopesProvider>
    )
    expect(host.canWrite).toBe(false)
  })

  it('loads the document for the web layout of the page', async () => {
    const f = routeFetch([['/editor?key=', res({ doc, phone: 'none' })]])
    setup()
    expect(await host.load()).toEqual(doc)
    expect(callsTo(f, '/editor')[0][0]).toBe(`/api/admin/site-builder/drafts/d1/editor?key=${KEY}`)
  })

  it('returns null when the document cannot be loaded', async () => {
    routeFetch([['/editor?key=', res({ error: 'gone' }, false)]])
    setup()
    expect(await host.load()).toBeNull()
  })

  it('saves the web layout, and the phone layout too while it is the same document', async () => {
    const f = routeFetch([
      ['/editor?key=', res({ doc, phone: 'same' })],
      ['/api/admin/site-builder/drafts/d1', res({ doc })],
    ])
    setup()
    await host.load()
    const out = await host.save(doc)
    expect(out).toEqual({ ok: true, doc })
    const puts = callsTo(f, 'drafts/d1').filter(([, i]) => (i as RequestInit)?.method === 'PUT')
    expect(puts).toHaveLength(2)
    expect(bodyOf(f, /drafts\/d1$/, 0).page.ref.surface).toBe('web')
    expect(bodyOf(f, /drafts\/d1$/, 1).page.ref.surface).toBe('web_mobile')
  })

  it('saves only the web layout when the phone has its own', async () => {
    const f = routeFetch([
      ['/editor?key=', res({ doc, phone: 'own' })],
      ['/api/admin/site-builder/drafts/d1', res({ doc })],
    ])
    setup()
    await host.load()
    await host.save(doc)
    expect(callsTo(f, /drafts\/d1$/)).toHaveLength(1)
  })

  it('reports why a save failed, for the web and the phone layout', async () => {
    routeFetch([['/api/admin/site-builder/drafts/d1', res({ error: 'Draft locked' }, false)]])
    setup()
    expect(await host.save(doc)).toEqual({ ok: false, error: 'Draft locked' })
    let n = 0
    routeFetch([
      ['/editor?key=', res({ doc, phone: 'same' })],
      ['/api/admin/site-builder/drafts/d1', () => (n++ === 0 ? res({ doc }) : res({ error: 'Phone layout locked' }, false))],
    ])
    setup()
    await host.load()
    expect(await host.save(doc)).toEqual({ ok: false, error: 'Phone layout locked' })
  })

  it('converts a block through the convert route', async () => {
    const f = routeFetch([['/site-builder/convert', res({ block: { id: 'b1', type: 'composed' } })]])
    setup()
    const out = await host.convertBlock({ id: 'b1', type: 'product_row' })
    expect(out).toEqual({ ok: true, block: { id: 'b1', type: 'composed' } })
    expect(bodyOf(f, '/convert')).toEqual({ page: 'home', block: { id: 'b1', type: 'product_row' } })
  })

  it('reports a conversion that failed', async () => {
    routeFetch([['/site-builder/convert', res({ error: 'Not convertible' }, false)]])
    setup()
    expect(await host.convertBlock({ id: 'b1' })).toEqual({ ok: false, error: 'Not convertible' })
    routeFetch([['/site-builder/convert', res({}, false)]])
    expect(await host.convertBlock({ id: 'b1' })).toEqual({ ok: false, error: 'Could not convert this section' })
  })

  it('offers no AI without canAi', () => {
    setup()
    expect(host.changeWithAi).toBeUndefined()
    expect(host.elementAi).toBeUndefined()
  })

  it('changes a selection with AI and reports the changed ids', async () => {
    const f = routeFetch([['/ai/selection', res({ tree: { kind: 'section' }, changed: ['n1'] })]])
    setup({ canAi: true })
    expect(host.aiNote).toBe('Billed to your AI wallet.')
    const out = await host.changeWithAi({ label: 'Banner', tree: { kind: 'section' }, ids: ['n1'], instruction: 'Shorter' })
    expect(out).toEqual({ ok: true, tree: { kind: 'section' }, changed: ['n1'] })
    expect(bodyOf(f, '/ai/selection')).toMatchObject({ ref: { audience: 'store', page: 'home' }, instruction: 'Shorter', draftId: 'd1' })
  })

  it('reports an AI failure with a default message', async () => {
    routeFetch([['/ai/selection', res({}, false)]])
    setup({ canAi: true })
    expect(await host.changeWithAi({ label: 'x', tree: {}, ids: [], instruction: 'y' })).toEqual({ ok: false, error: 'The AI could not make that change' })
  })

  it('runs element AI, passing the draft for pictures only', async () => {
    const f = routeFetch([['/ai/element', res({ text: 'Hello', url: '/p.jpg' })]])
    setup({ canAi: true })
    expect(await host.elementAi({ kind: 'text', prompt: 'x' })).toMatchObject({ ok: true, text: 'Hello' })
    expect(bodyOf(f, '/ai/element', 0)).toEqual({ kind: 'text', prompt: 'x' })
    await host.elementAi({ kind: 'picture', prompt: 'y' })
    expect(bodyOf(f, '/ai/element', 1)).toEqual({ kind: 'picture', prompt: 'y', draftId: 'd1' })
  })

  it('renders classic block fields only when section options are supplied', () => {
    setup()
    expect(host.renderBlockFields).toBeUndefined()
    setup({ options: { counts: {} } as any })
    expect(typeof host.renderBlockFields).toBe('function')
    expect(host.renderImagePicker).toBeDefined()
  })
})
