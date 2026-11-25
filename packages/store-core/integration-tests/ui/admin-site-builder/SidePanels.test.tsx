import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { emptyDoc, normalizeTheme, type Block, type PageDoc, type SiteTemplate } from '@jeffi/site-blocks'
import { BlockLibrary, ThemePanel, TemplatePanel } from '@/components/admin/site-builder/SidePanels'
import { siteRegistry } from '@/lib/site/blocks'
import { THEME_STYLES } from '@/lib/site/themes/catalog'
import { combo, choose } from '../admin-homepage/editor-kit'

// The Site Builder's side panels: the block library (add after the selected block; singletons and out-of-plan
// types disabled), the theme panel (colours, fonts, shape) and the template panel (built-in, saved and whole-site).
const home = { audience: 'store', surface: 'web', page: 'home' } as const
const block = (id: string, type: string): Block => ({ id, type, v: 1, props: {} })
const docWith = (...blocks: Block[]): PageDoc => ({ ...emptyDoc(), blocks: Object.fromEntries(blocks.map(b => [b.id, b])), order: blocks.map(b => b.id) })
const label = (type: string) => siteRegistry.get(type)!.label
// A library entry ignores a click for 300ms after mount (so a drag dropped on it is not a click).
const settle = () => new Promise(r => setTimeout(r, 350))

describe('BlockLibrary', () => {
  it('groups the blocks this page can have and adds one on click', async () => {
    const onAdd = vi.fn()
    render(<BlockLibrary pageRef={home} doc={emptyDoc()} planTypes={null} onAdd={onAdd} />)
    expect(screen.getByText('Products and offers')).toBeInTheDocument()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label('product_row')}`) }))
    expect(onAdd).toHaveBeenCalledWith('product_row')
  })

  it('does not list the composed block (it starts from the AI or My blocks)', () => {
    render(<BlockLibrary pageRef={home} doc={emptyDoc()} planTypes={null} onAdd={() => {}} />)
    expect(screen.queryByText(label('composed'))).toBeNull()
  })

  it('filters by search text', () => {
    render(<BlockLibrary pageRef={home} doc={emptyDoc()} planTypes={null} onAdd={() => {}} />)
    const all = screen.getAllByRole('button').length
    fireEvent.change(screen.getByPlaceholderText('Search blocks'), { target: { value: label('product_row') } })
    const some = screen.getAllByRole('button').length
    expect(some).toBeGreaterThan(0)
    expect(some).toBeLessThan(all)
  })

  it('disables a singleton that is already on the page', () => {
    const onAdd = vi.fn()
    render(<BlockLibrary pageRef={home} doc={docWith(block('b1', 'why_us'))} planTypes={null} onAdd={onAdd} />)
    const entry = screen.getByRole('button', { name: new RegExp(`^${label('why_us')}`) })
    expect(entry).toBeDisabled()
    expect(entry).toHaveTextContent('Already on the page')
    fireEvent.click(entry)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('disables section types outside the plan', () => {
    render(<BlockLibrary pageRef={home} doc={emptyDoc()} planTypes={['product_row']} onAdd={() => {}} />)
    expect(screen.getByRole('button', { name: new RegExp(`^${label('product_row')}`) })).toBeEnabled()
    expect(screen.getByRole('button', { name: new RegExp(`^${label('why_us')}`) })).toHaveTextContent('Not in your plan')
  })

  it('offers saved blocks, adds one and deletes one', async () => {
    const saved: SiteTemplate = {
      id: 't1',
      name: 'Summer hero',
      description: '',
      kind: 'block',
      pages: [{ audience: 'store', surface: 'web', page: 'home', doc: docWith(block('x', 'product_row')) }],
    } as any
    const onAddSaved = vi.fn()
    const onDeleteSaved = vi.fn()
    render(<BlockLibrary pageRef={home} doc={emptyDoc()} planTypes={null} onAdd={() => {}} saved={[saved]} onAddSaved={onAddSaved} onDeleteSaved={onDeleteSaved} />)
    expect(screen.getByText('My blocks')).toBeInTheDocument()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /^Summer hero/ }))
    expect(onAddSaved).toHaveBeenCalledWith(expect.objectContaining({ type: 'product_row' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Summer hero' }))
    expect(onDeleteSaved).toHaveBeenCalledWith(saved)
  })
})

describe('ThemePanel', () => {
  const theme = normalizeTheme({})

  it('shows the three colours and changes one', () => {
    const onChange = vi.fn()
    const { container } = render(<ThemePanel theme={theme} canWrite onChange={onChange} />)
    expect(screen.getByText('Brand colour')).toBeInTheDocument()
    expect(screen.getByText('Dark tone')).toBeInTheDocument()
    const first = container.querySelector('input[type="color"]') as HTMLInputElement
    fireEvent.change(first, { target: { value: '#112233' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ primary: '#112233' }))
  })

  it('saves a shape choice and clears an As-built style back to unset', () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={normalizeTheme({ ...theme, buttonShape: 'pill' } as any)} canWrite onChange={onChange} />)
    choose('Buttons', 'Outline')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ buttonStyle: 'outline' }))
    expect(combo('Button shape')).toHaveTextContent('Pill')
    choose('Button shape', 'As built')
    expect(onChange.mock.calls.at(-1)![0].buttonShape).toBeUndefined()
  })

  it('locks everything without write access', () => {
    const { container } = render(<ThemePanel theme={theme} canWrite={false} onChange={() => {}} />)
    expect((container.querySelector('input[type="color"]') as HTMLInputElement).disabled).toBe(true)
    expect(combo('Corners')).toBeDisabled()
  })
})

describe('TemplatePanel', () => {
  const page = (name: string, id: string, extra: Record<string, unknown> = {}): SiteTemplate =>
    ({ id, name, description: `${name} desc`, kind: 'page', pages: [{ audience: 'store', surface: 'web', page: 'home', doc: emptyDoc() }], ...extra }) as any
  const pack: SiteTemplate = {
    id: 'pack1',
    name: 'Bold store',
    description: 'Loud',
    kind: 'site',
    pages: [
      { audience: 'store', surface: 'web', page: 'home', doc: emptyDoc() },
      { audience: 'store', surface: 'web', page: 'cart', doc: emptyDoc() },
    ],
    theme: { primary: '#111111', accent: '#222222', neutral: '#333333', fontDisplay: 'Poppins', fontBody: 'Inter' },
  } as any

  function setup(templates: any, canWrite = true) {
    const fns = { onApply: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onApplyPack: vi.fn() }
    render(<TemplatePanel templates={templates} pageRef={home} canWrite={canWrite} {...fns} />)
    return fns
  }

  it('shows a loading line until templates arrive', () => {
    setup(null)
    expect(screen.getByText('Loading templates…')).toBeInTheDocument()
  })

  it('says when no template fits the page', () => {
    setup({ builtIn: [], saved: [] })
    expect(screen.getByText('No templates for this page yet.')).toBeInTheDocument()
  })

  it('lists saved and built-in templates for the page and applies or deletes them', () => {
    const fns = setup({ builtIn: [page('Classic home', 'b1')], saved: [page('My home', 's1')] })
    expect(screen.getByText('Yours')).toBeInTheDocument()
    expect(screen.getByText('Built in')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Use on this layout' })[0])
    expect(fns.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(fns.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
  })

  it('hides templates for other pages', () => {
    setup({ builtIn: [page('Cart only', 'b2', { pages: [{ audience: 'store', surface: 'web', page: 'cart', doc: emptyDoc() }] })], saved: [] })
    expect(screen.queryByText('Cart only')).toBeNull()
  })

  it('applies a whole-site style with its page count and fonts', () => {
    const fns = setup({ builtIn: [pack], saved: [] })
    expect(screen.getByText('Fonts: Poppins / Inter')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to the whole site (2 pages)' }))
    expect(fns.onApplyPack).toHaveBeenCalledWith(pack)
  })

  it('applies a ready-made theme palette as a pack', () => {
    const style = THEME_STYLES[0]
    const fns = setup({ builtIn: [], saved: [], themes: { [style]: { pages: 2, keys: ['home', 'cart'] } } })
    expect(screen.getByText('Ready-made themes')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^Apply .* to the whole site$/ })[0])
    const t = fns.onApplyPack.mock.calls[0][0]
    expect(t.id.startsWith('theme:')).toBe(true)
    expect(t.pages.map((p: any) => p.page)).toEqual(['home', 'cart'])
  })

  it('saves the layout as a template under a trimmed name', () => {
    const fns = setup({ builtIn: [], saved: [] })
    const save = screen.getByRole('button', { name: 'Save template' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Template name'), { target: { value: '  Festive  ' } })
    fireEvent.click(save)
    expect(fns.onSave).toHaveBeenCalledWith('Festive')
    expect(screen.getByPlaceholderText('Template name')).toHaveValue('')
  })

  it('hides every action without write access', () => {
    setup({ builtIn: [page('Classic home', 'b1'), pack], saved: [] }, false)
    expect(screen.queryByRole('button', { name: 'Use on this layout' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Apply to the whole site/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull()
  })
})
