import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImageGalleryEditor from '@/components/admin/ImageGalleryEditor'

const images = [
  { id: 'i1', image_url: 'https://cdn.test/1.jpg', thumbnail_url: 'https://cdn.test/1t.jpg', is_primary: true },
  { id: 'i2', image_url: 'https://cdn.test/2.jpg' },
  { id: 'i3', image_url: 'https://cdn.test/3.jpg' },
]

function setup(props: Partial<React.ComponentProps<typeof ImageGalleryEditor>> = {}) {
  const handlers = { onUpload: vi.fn(), onDelete: vi.fn(), onSetPrimary: vi.fn(), onReorder: vi.fn() }
  const view = render(<ImageGalleryEditor images={images} {...handlers} {...props} />)
  return { ...handlers, ...view }
}

const png = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('ImageGalleryEditor', () => {
  it('shows tiles with positions, the main badge and the usage counter', () => {
    const { container } = setup({ maxImages: 5 })
    expect(container.querySelectorAll('img')).toHaveLength(3)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/1t.jpg')
    expect(screen.getByText('Main')).toBeInTheDocument()
    expect(screen.getByText('3 of 5 used')).toBeInTheDocument()
    expect(screen.getByText(/Drag a tile to reorder/)).toBeInTheDocument()
  })

  it('shows the empty dropzone copy when there are no images', () => {
    setup({ images: [] })
    expect(screen.getByText('Drop images here, or click to browse')).toBeInTheDocument()
    expect(screen.queryByText(/Drag a tile/)).toBeNull()
  })

  it('sets a new main image but disables the button on the current one', () => {
    const { onSetPrimary } = setup()
    expect(screen.getByLabelText('Already the main image')).toBeDisabled()
    fireEvent.click(screen.getAllByLabelText('Set as main image')[0])
    expect(onSetPrimary).toHaveBeenCalledWith('i2')
  })

  it('deletes an image and disables the button while it is deleting', () => {
    const first = setup()
    fireEvent.click(screen.getAllByLabelText('Remove image')[1])
    expect(first.onDelete).toHaveBeenCalledWith('i2')
    first.unmount()
    setup({ deleting: { i1: true } })
    expect(screen.getAllByLabelText('Remove image')[0]).toBeDisabled()
  })

  it('reorders with the arrow buttons and disables the edges', () => {
    const { onReorder } = setup()
    expect(screen.getAllByLabelText('Move image left')[0]).toBeDisabled()
    expect(screen.getAllByLabelText('Move image right')[2]).toBeDisabled()
    fireEvent.click(screen.getAllByLabelText('Move image right')[0])
    expect(onReorder).toHaveBeenCalledWith(0, 1)
    fireEvent.click(screen.getAllByLabelText('Move image left')[2])
    expect(onReorder).toHaveBeenCalledWith(2, 1)
  })

  it('reorders by dragging one tile onto another', () => {
    const { onReorder, container } = setup()
    const tiles = container.querySelectorAll('[draggable="true"]')
    fireEvent.dragStart(tiles[0], { dataTransfer: { effectAllowed: '' } })
    fireEvent.dragEnter(tiles[2])
    fireEvent.drop(tiles[2])
    expect(onReorder).toHaveBeenCalledWith(0, 2)
  })

  it('dropping a tile on itself does nothing', () => {
    const { onReorder, container } = setup()
    const tiles = container.querySelectorAll('[draggable="true"]')
    fireEvent.dragStart(tiles[1], { dataTransfer: { effectAllowed: '' } })
    fireEvent.drop(tiles[1])
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('uploads each chosen image file up to the remaining slots, ignoring non-images', async () => {
    const { onUpload, container } = setup({ maxImages: 4 })
    const input = container.querySelector('input[type="file"]')!
    fireEvent.change(input, { target: { files: [png('a.png'), new File(['x'], 'b.txt', { type: 'text/plain' }), png('c.png')] } })
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(onUpload.mock.calls[0][0].name).toBe('a.png')
  })

  it('accepts files dropped on the grid while slots remain', async () => {
    const { onUpload, container } = setup()
    const grid = container.querySelector('.flex.flex-wrap.gap-2')!
    fireEvent.drop(grid, { dataTransfer: { types: ['Files'], files: [png('d.png')] } })
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
  })

  it('hides the add slot and gallery button when full', () => {
    const { container } = setup({ maxImages: 3, onOpenGallery: vi.fn(), extraActions: <button>extra</button> })
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Choose from Gallery' })).toBeNull()
    expect(screen.queryByText('extra')).toBeNull()
  })

  it('offers Choose from Gallery and extra actions while slots remain', () => {
    const onOpenGallery = vi.fn()
    setup({ maxImages: 5, onOpenGallery, extraActions: <button>extra</button> })
    fireEvent.click(screen.getByRole('button', { name: 'Choose from Gallery' }))
    expect(onOpenGallery).toHaveBeenCalled()
    expect(screen.getByText('extra')).toBeInTheDocument()
  })

  it('counts pending adds as used slots and shows placeholders', () => {
    const { container } = setup({ maxImages: 5, pendingAdds: 2 })
    expect(screen.getByText('5 of 5 used')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2)
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })

  it('shows an upload spinner state and an error message', () => {
    const { container } = setup({ uploading: true, error: 'Too big' })
    expect(screen.getByText('Too big')).toBeInTheDocument()
    expect(container.querySelector('label.pointer-events-none')).not.toBeNull()
  })
})
