import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Block } from '@jeffi/site-blocks'
import CodeSectionPanel from '@/components/admin/site-builder/CodeSectionPanel'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'
import { res, routeFetch, bodyOf, callsTo } from '../admin-marketplace/marketplace-kit'

// CodeSectionPanel: a code section in the inspector. Its words and links load from /site-builder/code as
// fields (an edit rewrites the source), and the AI can change the section from a plain-language ask.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/media/MediaField', () => ({ default: () => <div /> }))

const ref = { audience: 'store', surface: 'web', page: 'home' } as const
const block: Block = { id: 'b1', type: 'code_section', v: 1, props: { label: 'Banner', source: 'SRC-1' } }
const literals = [
  { id: 'h', kind: 'text', value: 'Welcome', label: 'Heading', line: 1 },
  { id: 'l', kind: 'link', value: '/shop', label: 'Button link', line: 2 },
]

function setup(opts: { role?: string; scopes?: string[]; pointed?: string | null } = {}) {
  const onChange = vi.fn()
  render(
    <AdminScopesProvider role={opts.role ?? 'administrator'} scopes={opts.scopes ?? []}>
      <CodeSectionPanel block={block} pageRef={ref} pointed={opts.pointed} onChange={onChange} />
    </AdminScopesProvider>
  )
  return { onChange }
}

describe('CodeSectionPanel', () => {
  beforeEach(() => showToast.mockClear())

  it('reads the section, then lists its words and links as fields', async () => {
    const f = routeFetch([['/site-builder/code', res({ literals })]])
    setup()
    expect(screen.getByText('Reading the section…')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Welcome')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/shop')).toBeInTheDocument()
    expect(bodyOf(f, '/code')).toEqual({ source: 'SRC-1', page: 'home' })
  })

  it('writes an edited word into the source and reports the new block', async () => {
    const f = routeFetch([
      [
        '/site-builder/code',
        (_u: string, init?: RequestInit) => (JSON.parse(String(init?.body)).edits ? res({ source: 'SRC-2', literals: [{ ...literals[0], value: 'Hello' }, literals[1]] }) : res({ literals })),
      ],
    ])
    const { onChange } = setup()
    const input = await screen.findByDisplayValue('Welcome')
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.blur(input)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...block, props: { ...block.props, source: 'SRC-2' } }))
    expect(bodyOf(f, '/code', 1).edits).toEqual([{ id: 'h', from: 'Welcome', to: 'Hello' }])
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
    expect(callsTo(f, '/code')).toHaveLength(2)
  })

  it('toasts when an edit cannot be made', async () => {
    routeFetch([
      [
        '/site-builder/code',
        (_u: string, init?: RequestInit) => (JSON.parse(String(init?.body)).edits ? res({ error: 'The section changed meanwhile' }, false) : res({ literals })),
      ],
    ])
    const { onChange } = setup()
    const input = await screen.findByDisplayValue('Welcome')
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.blur(input)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('The section changed meanwhile', 'error'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('asks the AI to change the section and applies the new source', async () => {
    const f = routeFetch([
      ['/ai/code', res({ source: 'SRC-AI', summary: 'Moved the picture' })],
      ['/site-builder/code', res({ literals })],
    ])
    const { onChange } = setup({ pointed: 'the picture' })
    await screen.findByDisplayValue('Welcome')
    expect(screen.getByText('Pointed at: “the picture”')).toBeInTheDocument()
    const run = screen.getByRole('button', { name: 'Change this section' })
    expect(run).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Put the picture on the left' }))
    expect(run).toBeEnabled()
    fireEvent.click(run)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...block, props: { ...block.props, source: 'SRC-AI' } }))
    expect(showToast).toHaveBeenCalledWith('Moved the picture. Undo reverts it.', 'success')
    expect(bodyOf(f, '/ai/code')).toMatchObject({ block: { id: 'b1', label: 'Banner', source: 'SRC-1' }, instruction: 'Put the picture on the left', hint: 'the picture' })
  })

  it('toasts an AI failure and keeps the source unchanged', async () => {
    routeFetch([
      ['/ai/code', res({ error: 'Out of credits' }, false)],
      ['/site-builder/code', res({ literals })],
    ])
    const { onChange } = setup()
    await screen.findByDisplayValue('Welcome')
    fireEvent.click(screen.getByRole('button', { name: 'Make the heading shorter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change this section' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Out of credits', 'error'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a read-only note, and loads nothing, without write access', () => {
    const f = routeFetch([['/site-builder/code', res({ literals })]])
    setup({ role: 'staff', scopes: [] })
    expect(screen.getByText(/changing it needs edit access to settings/)).toBeInTheDocument()
    expect(callsTo(f, '/code')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Change this section' })).toBeNull()
  })
})
