import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let galleryPick: any[] = []
vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onConfirm, onClose, maxSelect }: any) => (
    <div data-testid="gallery" data-max={maxSelect}>
      <button onClick={() => onConfirm(galleryPick)}>confirm-gallery</button>
      <button onClick={onClose}>close-gallery</button>
    </div>
  ),
}))
vi.mock('@/components/admin/ai/AiMediaButton', () => ({
  default: ({ onPick }: any) => (
    <button onClick={() => onPick({ url: 'https://cdn.test/ai.png', galleryId: 'ai1' })}>ai-image</button>
  ),
}))

import ImageUpload from '@/components/admin/ImageUpload'

const existing = [
  { id: 'e1', image_url: 'https://cdn.test/1.jpg', thumbnail_url: 'https://cdn.test/1t.jpg', file_name: 'one.jpg', file_size: 100, is_primary: true },
  { id: 'e2', image_url: 'https://cdn.test/2.jpg', thumbnail_url: 'https://cdn.test/2t.jpg', file_name: 'two.jpg', file_size: 200, is_primary: false },
]

const file = (name: string, size = 10) => {
  const f = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('ImageUpload', () => {
  beforeEach(() => {
    galleryPick = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
  })

  const selectFiles = (container: HTMLElement, files: File[]) =>
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })

  it('shows the empty state and the picker buttons', () => {
    render(<ImageUpload maxImages={3} />)
    expect(screen.getByText('No images selected yet')).toBeInTheDocument()
    expect(screen.getByText(/up to 3 images/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose from Gallery' })).toBeInTheDocument()
  })

  it('seeds existing images and reports them once on mount', () => {
    const onChange = vi.fn()
    render(<ImageUpload existingImages={existing} onImagesChange={onChange} />)
    expect(screen.getByAltText('one.jpg')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledTimes(1)
    const [files, keep, gallery, order] = onChange.mock.calls[0]
    expect(files).toEqual([])
    expect(keep.map((k: any) => k.id)).toEqual(['e1', 'e2'])
    expect(gallery).toEqual([])
    expect(order).toEqual(['existing:e1', 'existing:e2'])
  })

  it('adds selected files with the first one primary', () => {
    const onChange = vi.fn()
    const { container } = render(<ImageUpload onImagesChange={onChange} />)
    selectFiles(container, [file('a.png'), file('b.png')])
    expect(screen.getByText('a.png')).toBeInTheDocument()
    expect(screen.getByText('b.png')).toBeInTheDocument()
    expect(screen.getAllByText('Primary')).toHaveLength(1)
    const [files, , , order] = onChange.mock.lastCall!
    expect(files).toHaveLength(2)
    expect(order).toEqual(['file:0', 'file:1'])
  })

  it('rejects too many images', () => {
    const { container } = render(<ImageUpload maxImages={1} />)
    selectFiles(container, [file('a.png'), file('b.png')])
    expect(screen.getByText('You can only upload up to 1 images')).toBeInTheDocument()
    expect(screen.queryByText('a.png')).toBeNull()
  })

  it('rejects files over 5MB', () => {
    const { container } = render(<ImageUpload />)
    selectFiles(container, [file('huge.png', 6 * 1024 * 1024)])
    expect(screen.getByText('huge.png is too large (max 5MB per image)')).toBeInTheDocument()
  })

  it('sets a new primary image', () => {
    const onChange = vi.fn()
    render(<ImageUpload existingImages={existing} onImagesChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set Primary' }))
    const keep = onChange.mock.lastCall![1]
    expect(keep.find((k: any) => k.id === 'e2').is_primary).toBe(true)
    expect(keep.find((k: any) => k.id === 'e1').is_primary).toBe(false)
  })

  it('removing the primary promotes the next image', () => {
    const onChange = vi.fn()
    render(<ImageUpload existingImages={existing} onImagesChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.queryByAltText('one.jpg')).toBeNull()
    const keep = onChange.mock.lastCall![1]
    expect(keep).toHaveLength(1)
    expect(keep[0]).toMatchObject({ id: 'e2', is_primary: true })
  })

  it('reorders with the arrow buttons', () => {
    const onChange = vi.fn()
    render(<ImageUpload existingImages={existing} onImagesChange={onChange} />)
    expect(screen.getAllByLabelText('Move image left')[0]).toBeDisabled()
    expect(screen.getAllByLabelText('Move image right')[1]).toBeDisabled()
    fireEvent.click(screen.getAllByLabelText('Move image right')[0])
    expect(onChange.mock.lastCall![3]).toEqual(['existing:e2', 'existing:e1'])
  })

  it('reorders by drag and drop', () => {
    const onChange = vi.fn()
    const { container } = render(<ImageUpload existingImages={existing} onImagesChange={onChange} />)
    const tiles = container.querySelectorAll('[draggable="true"]')
    fireEvent.dragStart(tiles[0])
    fireEvent.dragEnter(tiles[1])
    fireEvent.dragEnd(tiles[0])
    expect(onChange.mock.lastCall![3]).toEqual(['existing:e2', 'existing:e1'])
  })

  it('opens the gallery, adds picked images and skips duplicates', () => {
    const onChange = vi.fn()
    galleryPick = [
      { id: 'g1', image_url: 'https://cdn.test/g1.jpg', thumbnail_url: 'https://cdn.test/g1t.jpg', file_name: 'g1.jpg' },
      { id: 'e1', image_url: 'x', thumbnail_url: null, file_name: 'dup.jpg' },
    ]
    render(<ImageUpload existingImages={existing} maxImages={5} onImagesChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose from Gallery' }))
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-max', '3')
    fireEvent.click(screen.getByText('confirm-gallery'))
    expect(screen.queryByTestId('gallery')).toBeNull()
    expect(screen.getByText('g1.jpg')).toBeInTheDocument()
    expect(screen.queryByText('dup.jpg')).toBeNull()
    expect(onChange.mock.lastCall![2]).toEqual([{ id: 'g1', isPrimary: false }])
    expect(onChange.mock.lastCall![3]).toContain('gallery:g1')
  })

  it('truncates a gallery pick to the remaining slots with a notice', () => {
    galleryPick = [
      { id: 'g1', image_url: 'a', thumbnail_url: null, file_name: 'g1.jpg' },
      { id: 'g2', image_url: 'b', thumbnail_url: null, file_name: 'g2.jpg' },
    ]
    render(<ImageUpload existingImages={existing} maxImages={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose from Gallery' }))
    fireEvent.click(screen.getByText('confirm-gallery'))
    expect(screen.getByText(/Only 1 slot\(s\) remaining/)).toBeInTheDocument()
  })

  it('hides the picker buttons once the limit is reached', () => {
    render(<ImageUpload existingImages={existing} maxImages={2} />)
    expect(screen.queryByRole('button', { name: 'Choose from Gallery' })).toBeNull()
  })

  it('closes the gallery without adding anything', () => {
    render(<ImageUpload />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose from Gallery' }))
    fireEvent.click(screen.getByText('close-gallery'))
    expect(screen.queryByTestId('gallery')).toBeNull()
  })

  it('AI generation adds the saved gallery image; absent without the ai prop', () => {
    const first = render(<ImageUpload />)
    expect(screen.queryByText('ai-image')).toBeNull()
    first.unmount()
    const onChange = vi.fn()
    render(<ImageUpload ai={{ defaultPrompt: 'a shirt' }} onImagesChange={onChange} />)
    fireEvent.click(screen.getByText('ai-image'))
    expect(onChange.mock.lastCall![2]).toEqual([{ id: 'ai1', isPrimary: true }])
  })
})
