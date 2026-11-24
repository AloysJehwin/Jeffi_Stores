import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SpinViewer from '@/components/media/SpinViewer'

const frames = ['/f0.jpg', '/f1.jpg', '/f2.jpg', '/f3.jpg']
const img = (c: HTMLElement) => c.querySelector('img') as HTMLImageElement

describe('SpinViewer', () => {
  it('shows the first frame with an accessible label and a drag hint', () => {
    const { container } = render(<SpinViewer frames={frames} alt="Halo" />)
    expect(img(container)).toHaveAttribute('src', '/f0.jpg')
    expect(screen.getByRole('img', { name: 'Halo: 360° view, drag to rotate' })).toBeInTheDocument()
    expect(screen.getByText(/Drag to rotate/)).toBeInTheDocument()
  })

  it('steps through frames with the arrow keys and wraps around', () => {
    const { container } = render(<SpinViewer frames={frames} />)
    const stage = screen.getByRole('img', { name: /Product: 360°/ })
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(img(container)).toHaveAttribute('src', '/f1.jpg')
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    expect(img(container)).toHaveAttribute('src', '/f3.jpg')
    fireEvent.keyDown(stage, { key: 'Tab' })
    expect(img(container)).toHaveAttribute('src', '/f3.jpg')
  })

  it('rotates while dragging and hides the hint once touched', () => {
    const { container } = render(<SpinViewer frames={frames} />)
    const stage = screen.getByRole('img', { name: /360°/ })
    Object.defineProperty(stage, 'clientWidth', { value: 400 })
    fireEvent.pointerDown(stage, { clientX: 200, pointerId: 1 })
    expect(screen.queryByText(/Drag to rotate/)).toBeNull()
    // A quarter of the width is one frame of four; dragging right shows the previous frame.
    fireEvent.pointerMove(stage, { clientX: 300 })
    expect(img(container)).toHaveAttribute('src', '/f3.jpg')
    fireEvent.pointerUp(stage)
    fireEvent.pointerMove(stage, { clientX: 0 })
    expect(img(container)).toHaveAttribute('src', '/f3.jpg')
  })

  it('renders nothing without frames', () => {
    const { container } = render(<SpinViewer frames={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
