import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CodeNode } from '@jeffi/site-blocks'
import Inspector from '@/components/site-editor/Inspector'

const lit = (v: string) => ({ k: 'lit' as const, v })
const text = (id: string, value: string): CodeNode => ({ t: 'text', value, id })
const tree: CodeNode = {
  t: 'el',
  tag: 'section',
  id: 'root',
  props: {},
  children: [
    { t: 'el', tag: 'h2', id: 'h', props: {}, children: [text('h.0', 'Hello world')] },
    { t: 'el', tag: 'img', id: 'img', props: { src: lit('/a.jpg'), alt: lit('A cat') }, children: [] },
    { t: 'el', tag: 'a', id: 'link', props: { href: lit('/shop') }, children: [text('link.0', 'Shop')] },
    { t: 'el', tag: 'img', id: 'dyn', props: { src: { k: 'path', root: 'p', path: ['image'] } }, children: [] },
    { t: 'el', tag: 'div', id: 'locked', locked: true, props: {}, children: [] },
  ],
}

const handlers = () => ({ onSelect: vi.fn(), onText: vi.fn(), onDone: vi.fn(), onAttr: vi.fn(), onAdd: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() })
const show = (id: string, over: Record<string, any> = {}) => {
  const h = handlers()
  render(<Inspector tree={tree} id={id} canWrite {...h} {...over} />)
  return h
}

describe('Inspector', () => {
  it('says so when the selected element no longer exists', () => {
    show('nope')
    expect(screen.getByText(/That element is gone/)).toBeInTheDocument()
  })

  it('shows breadcrumbs and selects an ancestor', () => {
    const h = show('h')
    const nav = screen.getByRole('navigation', { name: 'Where it sits' })
    expect(nav).toHaveTextContent('Section')
    fireEvent.click(screen.getByRole('button', { name: 'Section' }))
    expect(h.onSelect).toHaveBeenCalledWith('root')
    expect(screen.getByText('Heading 2', { selector: 'p' })).toBeInTheDocument()
  })

  it('edits written-out text (single line) and finishes the gesture on blur', () => {
    const h = show('h')
    const box = screen.getByLabelText('Text')
    expect(box).toHaveValue('Hello world')
    fireEvent.change(box, { target: { value: 'Hi\n there' } })
    expect(h.onText).toHaveBeenCalledWith('h', 'Hi there')
    fireEvent.blur(box)
    expect(h.onDone).toHaveBeenCalled()
  })

  it('runs the cheap AI text actions, including translation', () => {
    const ai = { busy: false, text: vi.fn(), picture: vi.fn() }
    show('h', { ai })
    fireEvent.click(screen.getByRole('button', { name: /Rewrite/ }))
    expect(ai.text).toHaveBeenLastCalledWith('h', 'Hello world', 'rewrite')
    fireEvent.click(screen.getByRole('button', { name: /Shorten/ }))
    expect(ai.text).toHaveBeenLastCalledWith('h', 'Hello world', 'shorten')
    const select = screen.getByLabelText('Translate into') as HTMLSelectElement
    const language = select.options[1].value
    fireEvent.change(select, { target: { value: language } })
    expect(ai.text).toHaveBeenLastCalledWith('h', 'Hello world', 'translate', language)
  })

  it('disables the AI actions and shows progress while it works', () => {
    show('h', { ai: { busy: true, text: vi.fn(), picture: vi.fn() } })
    expect(screen.getByLabelText('Working')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rewrite/ })).toBeDisabled()
  })

  it('edits a picture address and description', () => {
    const h = show('img')
    const src = screen.getByLabelText('Picture address')
    expect(src).toHaveValue('/a.jpg')
    fireEvent.change(src, { target: { value: ' /b.jpg ' } })
    fireEvent.keyDown(src, { key: 'Enter' })
    expect(h.onAttr).toHaveBeenLastCalledWith('img', 'src', '/b.jpg')
    const alt = screen.getByLabelText('Description (read aloud)')
    fireEvent.change(alt, { target: { value: 'A dog' } })
    fireEvent.blur(alt)
    expect(h.onAttr).toHaveBeenLastCalledWith('img', 'alt', 'A dog')
  })

  it('does not write an unchanged attribute', () => {
    const h = show('img')
    fireEvent.blur(screen.getByLabelText('Picture address'))
    expect(h.onAttr).not.toHaveBeenCalled()
  })

  it('uses the host image picker and the find-a-picture AI action when given', () => {
    const ai = { busy: false, text: vi.fn(), picture: vi.fn() }
    const renderImagePicker = vi.fn(({ onPick }: any) => <button onClick={() => onPick('/picked.jpg')}>Choose image</button>)
    const h = show('img', { ai, renderImagePicker })
    expect(renderImagePicker).toHaveBeenCalledWith(expect.objectContaining({ value: '/a.jpg', disabled: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }))
    expect(h.onAttr).toHaveBeenCalledWith('img', 'src', '/picked.jpg')
    fireEvent.click(screen.getByRole('button', { name: /Find a picture for this spot/ }))
    expect(ai.picture).toHaveBeenCalled()
  })

  it('says a data-driven picture comes from store data', () => {
    show('dyn')
    expect(screen.getByText('This picture comes from your store data.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Picture address')).toBeNull()
  })

  it('edits a link target', () => {
    const h = show('link')
    const goes = screen.getByLabelText('Goes to')
    fireEvent.change(goes, { target: { value: '/products' } })
    fireEvent.blur(goes)
    expect(h.onAttr).toHaveBeenCalledWith('link', 'href', '/products')
  })

  it('adds, duplicates and deletes elements', () => {
    const h = show('h')
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    expect(h.onDuplicate).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    expect(h.onDelete).toHaveBeenCalled()
    expect(screen.getByText(/Add after:/)).toBeInTheDocument()
    const adders = screen.getAllByRole('button').filter(b => !/Duplicate|Delete|Rewrite|Shorten|Section|Heading/.test(b.textContent || ''))
    fireEvent.click(adders[adders.length - 1])
    expect(h.onAdd).toHaveBeenCalled()
  })

  it('cannot duplicate or delete the root or a locked element', () => {
    show('root')
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
    expect(screen.getByText(/Add inside:/)).toBeInTheDocument()
  })

  it('explains a locked element and offers nothing to change without write access', () => {
    show('locked')
    expect(screen.getByText(/can be moved but not removed/)).toBeInTheDocument()
  })

  it('is read-only without write access', () => {
    show('h', { canWrite: false })
    expect(screen.getByLabelText('Text')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Duplicate/ })).toBeNull()
  })

  it('renders extra panels passed as children', () => {
    show('h', { children: <p>Style panel here</p> })
    expect(screen.getByText('Style panel here')).toBeInTheDocument()
  })
})
