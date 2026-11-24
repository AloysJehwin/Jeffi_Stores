import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { Block } from '@jeffi/site-blocks'
import ComposedEditor from '@/components/admin/site-builder/ComposedEditor'
import { renderAs, res, routeFetch, bodyOf } from '../admin-marketplace/marketplace-kit'

// ComposedEditor: a composed (AI-built) block's words, links and pictures as fields, a read-out of the live
// store data it shows, and "Save to my blocks". Edits write back into the block's tree through onChange.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))

const ref = { audience: 'store', surface: 'web', page: 'home' } as const
const tree = {
  kind: 'section',
  tone: 'default',
  padding: 'lg',
  width: 'normal',
  fx: 'none',
  children: [
    { kind: 'heading', level: 2, text: 'Big sale' },
    { kind: 'text', text: 'Everything must go' },
    { kind: 'button', label: 'Shop', href: '/products', variant: 'solid' },
    { kind: 'badge', text: 'New' },
    { kind: 'image', src: '/a.jpg' },
    { kind: 'countdown', endsAt: '2099-01-01T00:00' },
    { kind: 'marquee', items: ['Free delivery', 'Easy returns'] },
    { kind: 'products', query: { category: 'tools', onSale: true, sort: 'best_sellers', limit: 4 }, layout: 'grid' },
    { kind: 'offers', query: { limit: 3 }, layout: 'grid' },
  ],
}
const block = (props: Record<string, unknown> = { label: 'Sale strip', tree }): Block => ({ id: 'b1', type: 'composed', v: 1, props })

function setup(b: Block = block(), who: 'writer' | 'reader' = 'writer') {
  const onChange = vi.fn()
  const onSaved = vi.fn()
  renderAs(<ComposedEditor block={b} pageRef={ref} onChange={onChange} onSaved={onSaved} />, who)
  return { onChange, onSaved }
}

const lastTree = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0].props.tree

describe('ComposedEditor', () => {
  beforeEach(() => showToast.mockClear())

  it('asks for the AI when the block is empty', () => {
    setup(block({ label: 'Empty' }))
    expect(screen.getByText(/This block is empty/)).toBeInTheDocument()
  })

  it('shows a field for every editable node', () => {
    setup()
    expect(screen.getByDisplayValue('Big sale')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Everything must go')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Shop')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/products')).toBeInTheDocument()
    expect(screen.getByDisplayValue('New')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/a.jpg')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2099-01-01T00:00')).toBeInTheDocument()
    expect(screen.getByDisplayValue(/Free delivery/)).toBeInTheDocument()
    expect(screen.getByText('Heading 2')).toBeInTheDocument()
  })

  it('writes a heading edit into the tree at that node', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByDisplayValue('Big sale'), { target: { value: 'Mega sale' } })
    const t = lastTree(onChange)
    expect(t.children[0]).toMatchObject({ kind: 'heading', text: 'Mega sale' })
    expect(t.children[1].text).toBe('Everything must go')
  })

  it('edits a button label and link independently', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByDisplayValue('/products'), { target: { value: '/sale' } })
    expect(lastTree(onChange).children[2]).toMatchObject({ label: 'Shop', href: '/sale' })
    fireEvent.change(screen.getByDisplayValue('Shop'), { target: { value: 'Buy now' } })
    expect(lastTree(onChange).children[2].label).toBe('Buy now')
  })

  it('splits the scrolling text into one item per line, dropping blanks', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByDisplayValue(/Free delivery/), { target: { value: 'One\n\nTwo\nThree' } })
    expect(lastTree(onChange).children[6].items).toEqual(['One', 'Two', 'Three'])
  })

  it('describes what the data parts show from the live store', () => {
    setup()
    expect(screen.getByText('Live from your store')).toBeInTheDocument()
    expect(screen.getByText('Products: in tools, on sale, best sellers, up to 4')).toBeInTheDocument()
    expect(screen.getByText('Live offers, up to 3')).toBeInTheDocument()
  })

  it('saves the block to My blocks, with a toast and a refresh callback', async () => {
    const f = routeFetch([['/api/admin/site-builder/templates', res({})]])
    const { onSaved } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save to my blocks' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved to My blocks (Add → My blocks)', 'success'))
    expect(onSaved).toHaveBeenCalled()
    const body = bodyOf(f, '/templates')
    expect(body).toMatchObject({ name: 'Sale strip', kind: 'block' })
    expect(body.pages[0]).toMatchObject({ audience: 'store', surface: 'web', page: 'home' })
    const [id] = body.pages[0].doc.order
    expect(body.pages[0].doc.blocks[id]).toMatchObject({ type: 'composed', id })
  })

  it('toasts the server error when saving fails', async () => {
    routeFetch([['/templates', res({ error: 'Too many saved blocks' }, false)]])
    const { onSaved } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save to my blocks' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too many saved blocks', 'error'))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('is read-only without write access', () => {
    setup(block(), 'reader')
    expect(screen.getByDisplayValue('Big sale')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save to my blocks' })).toBeNull()
  })
})
