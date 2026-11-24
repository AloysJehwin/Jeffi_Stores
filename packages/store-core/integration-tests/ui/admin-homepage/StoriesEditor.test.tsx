import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import StoriesEditor from '@/components/admin/homepage/editors/StoriesEditor'
import { renderEditor, input, commit } from './editor-kit'

// StoriesEditor: story rings, each with a cover and image slides. Heavy children are stubbed: the media
// picker becomes a button that "uploads" /new.jpg, and the AI caption writer a button that fills captions.
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Jeffi' } }) }))
vi.mock('@/components/admin/media/MediaField', () => ({
  default: ({ label, allowVideo, onChange }: any) => (
    <button type="button" data-testid={`media-${label}`} onClick={() => onChange({ image: '/new.jpg', video: allowVideo ? '/new.mp4' : null })}>
      pick media
    </button>
  ),
}))
vi.mock('@/components/admin/ai/AiCopyButton', () => ({
  default: ({ label, fields, onFill, context }: any) => (
    <button
      type="button"
      data-context={context}
      onClick={() => onFill(Object.fromEntries(fields.map((f: any, i: number) => [f.name, `Caption ${i + 1}`])))}
    >
      {label}
    </button>
  ),
}))

const slide = (over: Record<string, unknown> = {}) => ({ id: 's1', image: '/a.jpg', caption: 'Hi', ctaLabel: '', url: '', ...over })
const group = (over: Record<string, unknown> = {}) => ({ id: 'g1', title: 'New this week', cover: '/c.jpg', slides: [slide()], ...over })

describe('StoriesEditor', () => {
  it('shows an empty state and adds a story with a minted id', () => {
    const { onSave } = renderEditor(StoriesEditor, 'stories')
    expect(screen.getByText(/No stories yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add story' }))
    const groups = onSave.mock.calls[0][1].config.groups
    expect(groups).toEqual([{ id: expect.any(String), title: '', cover: '', slides: [] }])
  })

  it('lists stories with their title and slides', () => {
    renderEditor(StoriesEditor, 'stories', { config: { groups: [group()] } })
    expect(screen.getByText('Story 1 · New this week')).toBeInTheDocument()
    expect(screen.getByText('Slide 1')).toBeInTheDocument()
    expect(screen.queryByText(/No stories yet/)).toBeNull()
  })

  it('saves an edited story title, keeping its slides and id', () => {
    const { onSave } = renderEditor(StoriesEditor, 'stories', { config: { groups: [group()] } })
    commit(input('Title'), 'Spring drop')
    const saved = onSave.mock.calls.at(-1)![1].config.groups[0]
    expect(saved).toMatchObject({ id: 'g1', title: 'Spring drop', cover: '/c.jpg' })
    expect(saved.slides[0]).toMatchObject({ id: 's1', image: '/a.jpg', caption: 'Hi' })
  })

  it('saves a new cover from the media picker', () => {
    const { onSave } = renderEditor(StoriesEditor, 'stories', { config: { groups: [group()] } })
    fireEvent.click(screen.getByTestId('media-Cover image'))
    expect(onSave.mock.calls.at(-1)![1].config.groups[0].cover).toBe('/new.jpg')
  })

  it('adds a slide to a story, minting its id', () => {
    const { onSave } = renderEditor(StoriesEditor, 'stories', { config: { groups: [group({ slides: [] })] } })
    // Two "Add tile" buttons are not present until a story exists; the slide list has the only one.
    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    const slides = onSave.mock.calls.at(-1)![1].config.groups[0].slides
    expect(slides).toHaveLength(1)
    expect(slides[0]).toMatchObject({ id: expect.any(String), image: '', caption: '' })
  })

  it('clamps slide seconds into 2-15 when saving', () => {
    const { onSave } = renderEditor(StoriesEditor, 'stories', { config: { groups: [group()] } })
    commit(input('Seconds (2–15)'), '40')
    expect(onSave.mock.calls.at(-1)![1].config.groups[0].slides[0].seconds).toBe(15)
    commit(input('Seconds (2–15)'), '1')
    expect(onSave.mock.calls.at(-1)![1].config.groups[0].slides[0].seconds).toBe(2)
  })

  it('writes captions for every slide with the AI button', () => {
    const { onSave } = renderEditor(StoriesEditor, 'stories', {
      config: { groups: [group({ slides: [slide(), slide({ id: 's2', caption: '' })] })] },
    })
    const btn = screen.getByRole('button', { name: 'Write captions with AI' })
    expect(btn.getAttribute('data-context')).toMatch(/Jeffi.*2 in the story "New this week"/)
    fireEvent.click(btn)
    const slides = onSave.mock.calls.at(-1)![1].config.groups[0].slides
    expect(slides.map((s: any) => s.caption)).toEqual(['Caption 1', 'Caption 2'])
  })

  it('hides the AI caption button for a story with no slides', () => {
    renderEditor(StoriesEditor, 'stories', { config: { groups: [group({ slides: [] })] } })
    expect(screen.queryByRole('button', { name: 'Write captions with AI' })).toBeNull()
  })

  it('reorders and removes stories', () => {
    const { onSave } = renderEditor(StoriesEditor, 'stories', {
      config: { groups: [group(), group({ id: 'g2', title: 'Sale' })] },
    })
    expect(screen.getAllByRole('button', { name: 'Up' })[0]).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Down' })[0])
    expect(onSave.mock.calls.at(-1)![1].config.groups.map((g: any) => g.id)).toEqual(['g2', 'g1'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(onSave.mock.calls.at(-1)![1].config.groups.map((g: any) => g.id)).toEqual(['g2'])
  })

  it('notes stories that the storefront will not show yet', () => {
    renderEditor(StoriesEditor, 'stories', { config: { groups: [group({ cover: '' })] } })
    expect(screen.getByText(/One story is not shown on the storefront yet/)).toBeInTheDocument()
  })

  it('flags stories with unsafe links', () => {
    renderEditor(StoriesEditor, 'stories', { config: { groups: [group({ slides: [slide({ url: 'javascript:1' })] })] } })
    expect(screen.getByText(/One story has a link that will be ignored/)).toBeInTheDocument()
  })

  it('locks every control without write access', () => {
    renderEditor(StoriesEditor, 'stories', { config: { groups: [group()] } }, { canWrite: false })
    expect(screen.getByRole('button', { name: 'Add story' })).toBeDisabled()
    expect(input('Title')).toBeDisabled()
  })
})
