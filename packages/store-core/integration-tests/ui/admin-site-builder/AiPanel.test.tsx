import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { emptyDoc, normalizeTheme, type Block, type PageDoc } from '@jeffi/site-blocks'
import AiPanel from '@/components/admin/site-builder/AiPanel'
import { siteRegistry } from '@/lib/site/blocks'
import { renderAs, res, routeFetch, bodyOf, callsTo } from '../admin-marketplace/marketplace-kit'

// AiPanel: ask the AI to build the page, correct the picked block (composed and code blocks have their own
// endpoints), make a new block, run the critique pass, or redesign the page with the Site Studio. Results are
// applied as ordinary edits through onApply. fetch is stubbed.
const home = { audience: 'store', surface: 'web', page: 'home' } as const
const block = (type: string, props: Record<string, unknown> = {}): Block => ({ id: 'b1', type, v: 1, props })
const docWith = (b: Block): PageDoc => ({ ...emptyDoc(), blocks: { [b.id]: b }, order: [b.id] })
const label = (t: string) => siteRegistry.get(t)!.label

function setup(over: Partial<React.ComponentProps<typeof AiPanel>> = {}, who: 'writer' | 'reader' = 'writer') {
  const onApply = vi.fn()
  const onPickMode = vi.fn()
  const props = { doc: emptyDoc(), pageRef: home, block: undefined, pointed: null, picking: false, onPickMode, onApply, ...over } as React.ComponentProps<typeof AiPanel>
  const utils = renderAs(<AiPanel {...props} />, who)
  return { onApply, onPickMode, ...utils }
}

const type = (text: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })

describe('AiPanel', () => {
  it('targets the whole page, and builds it from a prompt', async () => {
    const f = routeFetch([['/api/admin/site-builder/ai', res({ doc: docWith(block('hero')), summary: 'Built a sale page' })]])
    const { onApply } = setup()
    expect(screen.getByText('Target: the whole page')).toBeInTheDocument()
    const build = screen.getByRole('button', { name: 'Build the whole page' })
    expect(build).toBeDisabled()
    type('A festive sale homepage')
    fireEvent.click(build)
    expect(await screen.findByText('Built a sale page Undo reverts it.')).toBeInTheDocument()
    expect(bodyOf(f, '/ai')).toMatchObject({ ref: home, prompt: 'A festive sale homepage' })
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ order: ['b1'] }), 'Built a sale page')
  })

  it('shows the error when the AI cannot make the change', async () => {
    routeFetch([['/api/admin/site-builder/ai', res({ error: 'Out of credits' }, false)]])
    const { onApply } = setup()
    type('Anything')
    fireEvent.click(screen.getByRole('button', { name: 'Build the whole page' }))
    expect(await screen.findByText('Out of credits')).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('fills the prompt from an idea chip', () => {
    setup()
    const chip = screen.getByRole('button', { name: /festive sale homepage with offers up top/ })
    fireEvent.click(chip)
    expect(screen.getByRole('textbox')).toHaveValue('A festive sale homepage with offers up top')
  })

  it('toggles the arrow tool', () => {
    const { onPickMode } = setup({ picking: true })
    fireEvent.click(screen.getByRole('button', { name: /Arrow on/ }))
    expect(onPickMode).toHaveBeenCalled()
  })

  it('corrects the picked block, sending its id and what was pointed at', async () => {
    const b = block('product_row')
    const f = routeFetch([['/api/admin/site-builder/ai', res({ doc: docWith(b), summary: 'Shorter heading' })]])
    const { onApply } = setup({ block: b, doc: docWith(b), pointed: 'the heading' })
    expect(screen.getByText(`Target: ${label('product_row')}`)).toBeInTheDocument()
    expect(screen.getByText('Pointed at: “the heading”')).toBeInTheDocument()
    type('Make the heading shorter')
    fireEvent.click(screen.getByRole('button', { name: `Correct ${label('product_row')}` }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.anything(), 'Shorter heading'))
    expect(bodyOf(f, '/ai')).toMatchObject({ blockId: 'b1', hint: 'the heading', prompt: 'Make the heading shorter' })
  })

  it('rewrites a code section through the code endpoint', async () => {
    const b = block('code_section', { label: 'Banner', source: 'old' })
    const f = routeFetch([['/ai/code', res({ source: 'new source', summary: 'Recoloured' })]])
    const { onApply } = setup({ block: b, doc: docWith(b), draftId: 'd1' })
    type('Use a darker background')
    fireEvent.click(screen.getByRole('button', { name: /^Correct / }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(onApply.mock.calls[0][0].blocks.b1.props.source).toBe('new source')
    expect(bodyOf(f, '/ai/code')).toMatchObject({ block: { id: 'b1', label: 'Banner', source: 'old' }, instruction: 'Use a darker background', draftId: 'd1' })
  })

  it('makes a new composed block after the selected one', async () => {
    const b = block('product_row')
    routeFetch([['/ai/compose', res({ label: 'Offers strip', tree: { kind: 'section' }, summary: 'Added a strip' })]])
    const { onApply } = setup({ block: b, doc: docWith(b) })
    type('Three reviews and a countdown')
    fireEvent.click(screen.getByRole('button', { name: 'Make a new block' }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    const next: PageDoc = onApply.mock.calls[0][0]
    expect(next.order).toHaveLength(2)
    expect(next.order[0]).toBe('b1')
    expect(next.blocks[next.order[1]]).toMatchObject({ type: 'composed', props: { label: 'Offers strip' } })
  })

  it('changes the selected composed block in place', async () => {
    const b = block('composed', { label: 'Mine', tree: { kind: 'section' } })
    const f = routeFetch([['/ai/compose', res({ label: 'Mine v2', tree: { kind: 'section', x: 1 }, summary: 'Tweaked' })]])
    const { onApply } = setup({ block: b, doc: docWith(b), pointed: 'button' })
    type('Rename the button')
    fireEvent.click(screen.getByRole('button', { name: /^Correct / }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(onApply.mock.calls[0][0].order).toEqual(['b1'])
    expect(bodyOf(f, '/ai/compose').current).toEqual({ label: 'Mine', tree: { kind: 'section' } })
    expect(screen.queryByRole('button', { name: 'Make a new block' })).toBeNull()
  })

  it('checks the page, lists findings and fixes the fixable ones', async () => {
    const theme = normalizeTheme({})
    const f = routeFetch([
      [
        '/critique',
        (_u: string, init?: RequestInit) =>
          JSON.parse(String(init?.body)).fix
            ? res({ findings: [], fixed: 1, doc: docWith(block('hero')), theme })
            : res({ findings: [{ severity: 'error', message: 'Hero has no picture', fixable: true }, { severity: 'warn', message: 'Heading is long', fixable: false }] }),
      ],
    ])
    const onThemeChange = vi.fn()
    const { onApply } = setup({ theme, onThemeChange })
    expect(screen.getByText(/Finds empty blocks/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Hero has no picture')).toBeInTheDocument()
    expect(screen.getByText('Heading is long (needs you)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fix 1' }))
    expect(await screen.findByText('Fixed 1 issue(s). Undo reverts the page.')).toBeInTheDocument()
    expect(onApply).toHaveBeenCalledWith(expect.anything(), 'Fixed 1 issue(s)')
    expect(onThemeChange).toHaveBeenCalled()
    expect(callsTo(f, '/critique')).toHaveLength(2)
  })

  it('reports a clean page and a failed check', async () => {
    routeFetch([['/critique', res({ findings: [] })]])
    const { unmount } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Nothing to fix on this page.')).toBeInTheDocument()
    unmount()
    routeFetch([['/critique', res({ error: 'Busy' }, false)]])
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Busy')).toBeInTheDocument()
  })

  it('offers to design a studio page again and shows its progress', () => {
    const onRedo = vi.fn()
    const { unmount } = setup({ onRedo })
    fireEvent.click(screen.getByRole('button', { name: 'Design again' }))
    expect(onRedo).toHaveBeenCalled()
    unmount()
    setup({ onRedo, redo: { key: 'store:home', label: 'Home', status: 'running' } })
    expect(screen.getByRole('button', { name: 'Designing…' })).toBeDisabled()
    expect(screen.getByText(/planning and writing this page afresh/)).toBeInTheDocument()
  })

  it('says another page is being designed, and reports done and failed', () => {
    const base = { onRedo: vi.fn() }
    const a = setup({ ...base, redo: { key: 'store:cart', label: 'Cart', status: 'running' } })
    expect(screen.getByText('The AI is designing Cart again; one page at a time.')).toBeInTheDocument()
    a.unmount()
    const b = setup({ ...base, redo: { key: 'store:home', label: 'Home', status: 'done', message: '5 sections.' } })
    expect(screen.getByText(/Designed again\. 5 sections\./)).toBeInTheDocument()
    b.unmount()
    setup({ ...base, redo: { key: 'store:home', label: 'Home', status: 'failed', message: 'Timed out' } })
    expect(screen.getByText('Timed out')).toBeInTheDocument()
  })

  it('does not offer a redo on pages the studio does not design', () => {
    setup({ onRedo: vi.fn(), pageRef: { audience: 'store', surface: 'app', page: 'home' } })
    expect(screen.queryByRole('button', { name: 'Design again' })).toBeNull()
  })

  it('disables every AI action without write access', () => {
    setup({ onRedo: vi.fn() }, 'reader')
    type('Something')
    expect(screen.getByRole('button', { name: 'Build the whole page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Design again' })).toBeDisabled()
  })
})
