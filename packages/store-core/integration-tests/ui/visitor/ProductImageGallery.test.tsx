import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

let pagerProps: any
vi.mock('@/components/visitor/slides/Slides', () => ({
  default: (p: any) => {
    pagerProps = p
    return <div data-testid="pager" aria-label={p.ariaLabel} data-index={p.index ?? ''} data-default={p.defaultIndex}>{p.children}</div>
  },
}))
const swipeBind = {
  onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(), onClickCapture: vi.fn(), onDragStart: vi.fn(),
}
vi.mock('@/components/visitor/slides/useSwipe', () => ({ useSwipe: () => ({ bind: swipeBind }) }))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))

import ProductImageGallery, { Lightbox } from '@/components/visitor/ProductImageGallery'

const img = (i: number) => ({ id: `i${i}`, image_url: `/img${i}.jpg`, thumbnail_url: `/thumb${i}.jpg`, is_primary: i === 1 })
const images = [img(1), img(2), img(3)]

describe('ProductImageGallery', () => {
  beforeEach(() => {
    pagerProps = undefined
    document.body.style.overflow = ''
  })

  it('shows a placeholder when there are no images', () => {
    const { container } = render(<ProductImageGallery images={[]} productName="Halo" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders the main image, the phone pager and one thumbnail per image', () => {
    render(<ProductImageGallery images={images} productName="Halo" />)
    expect(screen.getByTestId('pager')).toHaveAttribute('aria-label', 'Halo images')
    expect(screen.getAllByAltText('Halo - Image 1').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByAltText(/Halo - Thumbnail/)).toHaveLength(3)
    expect(screen.getByAltText('Halo - Thumbnail 2')).toHaveAttribute('src', '/thumb2.jpg')
  })

  it('a single image gets no thumbnail strip', () => {
    render(<ProductImageGallery images={[img(1)]} productName="Halo" />)
    expect(screen.queryByAltText(/Thumbnail/)).not.toBeInTheDocument()
  })

  it('selecting a thumbnail changes the main image, marks it current and steers the pager', () => {
    render(<ProductImageGallery images={images} productName="Halo" />)
    const thumb = screen.getByAltText('Halo - Thumbnail 3').closest('button')!
    fireEvent.click(thumb)
    expect(thumb).toHaveAttribute('aria-current', 'true')
    expect(screen.getAllByAltText('Halo - Image 3').length).toBeGreaterThan(0)
    expect(screen.getByTestId('pager')).toHaveAttribute('data-index', '2')
  })

  it('the pager reports a swipe back as the selected image once it lands', () => {
    render(<ProductImageGallery images={images} productName="Halo" />)
    expect(pagerProps.defaultIndex).toBe(0)
    fireEvent.click(screen.getByAltText('Halo - Thumbnail 2').closest('button')!)
    expect(pagerProps.index).toBe(1)
    // a pass-through page before arrival is ignored
    act(() => pagerProps.onIndexChange(0))
    expect(screen.getByAltText('Halo - Thumbnail 2').closest('button')).toHaveAttribute('aria-current', 'true')
    act(() => pagerProps.onIndexChange(1))
    expect(pagerProps.index).toBeUndefined()
    act(() => pagerProps.onIndexChange(2))
    expect(screen.getByAltText('Halo - Thumbnail 3').closest('button')).toHaveAttribute('aria-current', 'true')
  })

  it('arrow keys move through the gallery and wrap', () => {
    const { container } = render(<ProductImageGallery images={images} productName="Halo" />)
    const root = container.firstChild as HTMLElement
    fireEvent.keyDown(root, { key: 'ArrowLeft' })
    expect(screen.getByAltText('Halo - Thumbnail 3').closest('button')).toHaveAttribute('aria-current', 'true')
    fireEvent.keyDown(root, { key: 'ArrowRight' })
    expect(screen.getByAltText('Halo - Thumbnail 1').closest('button')).toHaveAttribute('aria-current', 'true')
    fireEvent.keyDown(root, { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByAltText('Halo - Thumbnail 1').closest('button')).toHaveAttribute('aria-current', 'true')
  })

  it('shows variant images instead of the product images, starting on the first', () => {
    const variant = [{ id: 'v1', image_url: '/v1.jpg', thumbnail_url: '/vt1.jpg', is_primary: true }, { id: 'v2', image_url: '/v2.jpg', thumbnail_url: '/vt2.jpg', is_primary: false }]
    const { rerender } = render(<ProductImageGallery images={images} productName="Halo" />)
    fireEvent.click(screen.getByAltText('Halo - Thumbnail 3').closest('button')!)
    rerender(<ProductImageGallery images={images} productName="Halo" variantImages={variant} />)
    expect(screen.getAllByAltText(/Halo - Thumbnail/)).toHaveLength(2)
    expect(screen.getByAltText('Halo - Thumbnail 1').closest('button')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByAltText('Halo - Thumbnail 1')).toHaveAttribute('src', '/vt1.jpg')
  })

  it('draws the SALE ribbon only with a discount and a business ribbon label when given', () => {
    const a = render(<ProductImageGallery images={images} productName="Halo" />)
    expect(screen.queryByText('SALE')).not.toBeInTheDocument()
    a.unmount()
    render(<ProductImageGallery images={images} productName="Halo" discountPct={20} ribbonLabel="Business price" />)
    expect(screen.getAllByText('SALE').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Business price').length).toBeGreaterThan(0)
  })

  it('the desktop image zooms on hover and follows the pointer', () => {
    const { container } = render(<ProductImageGallery images={images} productName="Halo" />)
    const main = container.querySelector('.cursor-zoom-in') as HTMLElement
    fireEvent.mouseEnter(main)
    expect(container.querySelector('.scale-150')).not.toBeNull()
    fireEvent.mouseMove(main, { clientX: 10, clientY: 10 })
    fireEvent.mouseLeave(main)
    expect(container.querySelector('.scale-150')).toBeNull()
  })

  it('opens the lightbox from the desktop image (click, Enter, Space) and the phone pager, and closes it', () => {
    render(<ProductImageGallery images={images} productName="Halo" />)
    const main = screen.getAllByRole('button').find(b => b.getAttribute('role') === 'button' && b.tabIndex === 0)!
    fireEvent.click(main)
    expect(screen.getByRole('dialog', { name: 'Halo images' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    fireEvent.keyDown(main, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(main, { key: ' ' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(screen.getByTestId('pager')).getAllByRole('button')[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Lightbox', () => {
  const setup = (over: Record<string, any> = {}) => {
    const onIndex = vi.fn()
    const onClose = vi.fn()
    render(<Lightbox images={images} index={1} productName="Halo" onIndex={onIndex} onClose={onClose} {...over} />)
    return { onIndex, onClose }
  }

  it('shows the counter, the current image, thumbnails and focuses Close', () => {
    setup()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByAltText('Halo - Image 2')).toHaveAttribute('src', '/img2.jpg')
    expect(screen.getAllByAltText(/^Thumbnail/)).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('previous/next wrap around the ends', () => {
    const { onIndex } = setup({ index: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(onIndex).toHaveBeenLastCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(onIndex).toHaveBeenLastCalledWith(1)
  })

  it('thumbnails jump to an image without closing', () => {
    const { onIndex, onClose } = setup()
    fireEvent.click(screen.getByAltText('Thumbnail 3').closest('button')!)
    expect(onIndex).toHaveBeenCalledWith(2)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keyboard: Escape closes, arrows navigate', () => {
    const { onIndex, onClose } = setup()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onIndex).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(onIndex).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the backdrop closes but clicking the image does not', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByAltText('Halo - Image 2'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab inside the dialog', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    const buttons = dialog.querySelectorAll('button')
    ;(buttons[buttons.length - 1] as HTMLElement).focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(buttons[0]).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(buttons[buttons.length - 1]).toHaveFocus()
  })

  it('a single image has no arrows or thumbnails', () => {
    setup({ images: [img(1)], index: 0 })
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    expect(screen.queryByAltText(/^Thumbnail/)).not.toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })

  it('a double tap on the image zooms in and a second double tap resets', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    const image = screen.getByAltText('Halo - Image 2')
    const box = image.closest('.max-h-\\[85vh\\]') as HTMLElement
    box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
    const tap = () => {
      fireEvent.pointerDown(image, { pointerId: 1, clientX: 100, clientY: 50, button: 0 })
      fireEvent.pointerUp(image, { pointerId: 1, clientX: 100, clientY: 50, button: 0 })
    }
    tap()
    tap()
    expect(dialog.querySelector('[style*="scale(2)"]')).not.toBeNull()
    tap()
    tap()
    expect(dialog.querySelector('[style*="scale("]')).toBeNull()
  })

  it('pointer events on buttons are left to the buttons', () => {
    setup()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Next image' }), { pointerId: 1, button: 0 })
    expect(swipeBind.onPointerDown).not.toHaveBeenCalled()
  })
})
