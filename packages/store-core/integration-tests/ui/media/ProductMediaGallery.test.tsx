import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/media/MediaItemView', () => ({
  default: ({ m }: any) => <div data-testid="stage">{m.id}</div>,
  MediaThumb: ({ m }: any) => <span>{m.id}</span>,
  KIND_LABEL: { image: 'Image', video: 'Video', document: 'Document', audio: 'Audio' },
}))

import ProductMediaGallery from '@/components/media/ProductMediaGallery'

const m = (id: string, kind = 'image', over: Record<string, any> = {}): any => ({ id, kind, url: `/${id}`, caption: null, ...over })

describe('ProductMediaGallery', () => {
  it('shows the first item on the stage and a thumbnail per item', () => {
    render(<ProductMediaGallery items={[m('a'), m('b', 'video')]} />)
    expect(screen.getByTestId('stage')).toHaveTextContent('a')
    expect(screen.getByRole('button', { name: 'Image 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Video 2' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches the stage when a thumbnail is clicked and shows that item caption', () => {
    render(<ProductMediaGallery items={[m('a'), m('b', 'video', { caption: 'Unboxing' })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Video 2' }))
    expect(screen.getByTestId('stage')).toHaveTextContent('b')
    expect(screen.getByText('Unboxing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Video 2' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides the caption for audio and leaves documents out of the stage and strip', () => {
    render(<ProductMediaGallery items={[m('d', 'document'), m('s', 'audio', { caption: 'Sound' })]} />)
    expect(screen.getByTestId('stage')).toHaveTextContent('s')
    expect(screen.queryByText('Sound')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('resets to the first item when the set of items changes (variant switch)', () => {
    const { rerender } = render(<ProductMediaGallery items={[m('a'), m('b')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Image 2' }))
    expect(screen.getByTestId('stage')).toHaveTextContent('b')
    rerender(<ProductMediaGallery items={[m('x'), m('y')]} />)
    expect(screen.getByTestId('stage')).toHaveTextContent('x')
  })

  it('renders the empty node when there is nothing to show', () => {
    render(<ProductMediaGallery items={[m('d', 'document')]} emptyNode={<p>No media yet</p>} />)
    expect(screen.getByText('No media yet')).toBeInTheDocument()
  })
})
