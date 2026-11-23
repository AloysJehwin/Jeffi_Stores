import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import SiteEditor from '@/components/site-editor/SiteEditor'
import type { SiteEditorHost } from '@/components/site-editor/host'

// The visual editor's shell with a fake host: it loads the page, records what the canvas (the bridge, faked with
// messages from the iframe) and the inspector send, autosaves trees with an empty source, and undoes onto the canvas.

const tree = (h: string): CodeNode => ({ t: 'el', tag: 'section', props: {}, id: 'e1', children: [{ t: 'el', tag: 'h2', props: {}, id: 'e2', children: [{ t: 'text', value: h, id: 'e2.0' }] }] })
const doc = (): PageDoc => ({
  schemaVersion: 1,
  order: ['a', 'c'],
  blocks: {
    a: { id: 'a', type: 'code_section', v: 1, props: { label: 'Hero', source: 'x', tree: tree('Hello'), compiled: null } },
    c: { id: 'c', type: 'rich_text', v: 1, props: {} },
  },
})

function setup(over: Partial<SiteEditorHost> = {}) {
  const save = vi.fn(async (d: PageDoc) => ({ ok: true as const, doc: d }))
  const host: SiteEditorHost = { title: 'Home', load: async () => doc(), save, previewUrl: 'about:blank', canWrite: true, blockLabel: () => 'Rich text', ...over }
  render(<SiteEditor host={host} />)
  return { save, host }
}

/** The canvas's window (happy-dom loads no iframe pages): what the editor posts to the bridge lands in `post`. */
async function canvas() {
  const frame = (await screen.findByTitle('Page canvas')) as HTMLIFrameElement & { fake?: { postMessage: ReturnType<typeof vi.fn> } }
  if (!frame.fake) {
    frame.fake = { postMessage: vi.fn() }
    Object.defineProperty(frame, 'contentWindow', { value: frame.fake })
  }
  return frame.fake
}

/** A message from the canvas, as the bridge sends it. */
async function fromCanvas(data: Record<string, unknown>) {
  const win = await canvas()
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data: { ...data, type: `site-editor:${data.type}` }, source: win as unknown as Window }))
  })
  return win
}

const words = (t: unknown) => JSON.stringify(t).match(/"value":"([^"]*)"/)?.[1]

describe('SiteEditor', () => {
  it('loads the page and lists its sections', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Hero' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rich text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('says so when the page cannot be opened', async () => {
    setup({ load: async () => null })
    expect(await screen.findByText(/could not be opened/)).toBeInTheDocument()
  })

  it('autosaves words typed on the canvas as the tree, with an empty source', async () => {
    const { save } = setup()
    await screen.findByRole('button', { name: 'Hero' })
    await fromCanvas({ type: 'ops', block: 'a', ops: [{ op: 'text', id: 'e2', value: 'Typed' }] })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 })
    const sent = save.mock.calls[0][0]
    expect(sent.blocks.a.props.source).toBe('')
    expect(words(sent.blocks.a.props.tree)).toBe('Typed')
    expect(await screen.findByText('Saved to draft')).toBeInTheDocument()
  })

  it('edits the selected element in the inspector and undoes onto the canvas', async () => {
    const { save } = setup()
    await screen.findByRole('button', { name: 'Hero' })
    const post = (await fromCanvas({ type: 'select', block: 'a', id: 'e2' })).postMessage
    const box = await screen.findByDisplayValue('Hello')
    fireEvent.change(box, { target: { value: 'Welcome' } })
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'site-editor:apply', block: 'a', ops: [{ op: 'text', id: 'e2', value: 'Welcome' }] }), '*')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'site-editor:apply', ops: [{ op: 'text', id: 'e2', value: 'Hello' }] }), '*')
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 })
    expect(words(save.mock.calls.at(-1)![0].blocks.a.props.tree)).toBe('Hello')
  })

  it('styles per breakpoint: the canvas narrows, and Phone and Desktop values land in their own classes', async () => {
    const { save } = setup()
    await screen.findByRole('button', { name: 'Hero' })
    const post = (await fromCanvas({ type: 'select', block: 'a', id: 'e2' })).postMessage
    fireEvent.click(screen.getByRole('button', { name: /Phone/ }))
    expect((screen.getByTitle('Page canvas') as HTMLIFrameElement).style.width).toBe('390px')
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'xl' } })
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'site-editor:apply', ops: [{ op: 'classes', id: 'e2', bp: 'base', value: ['text-xl'] }] }), '*')
    fireEvent.click(screen.getByRole('button', { name: /Desktop/ }))
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '4xl' } })
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 })
    const h2 = (save.mock.calls.at(-1)![0].blocks.a.props.tree as { children: { props: { className?: { v: string } } }[] }).children[0]
    expect(h2.props.className?.v).toBe('text-xl lg:text-4xl')
  })

  it('shows a refused save and keeps the edit to undo', async () => {
    setup({ save: async () => ({ ok: false, error: 'Hero: line 3: nope' }) })
    await screen.findByRole('button', { name: 'Hero' })
    await fromCanvas({ type: 'ops', block: 'a', ops: [{ op: 'text', id: 'e2', value: 'Bad' }] })
    expect(await screen.findByText('Hero: line 3: nope', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })
})

describe('SiteEditor layers', () => {
  it('opens a section into its elements and selects one for the inspector and the canvas', async () => {
    setup()
    await screen.findByRole('button', { name: 'Hero' })
    const post = (await canvas()).postMessage
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand' })[0])
    fireEvent.click(await screen.findByRole('button', { name: /Heading 2\s*Hello/ }))
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
    expect(post).toHaveBeenLastCalledWith({ type: 'site-editor:select', block: 'a', id: 'e2' }, '*')
  })
})
