import React, { Suspense } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// next/dynamic -> React.lazy, so the heavy viewers resolve (as stubs) like they do in the app.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) => {
    const Lazy = React.lazy(loader)
    return (p: any) => (
      <Suspense fallback={null}>
        <Lazy {...p} />
      </Suspense>
    )
  },
}))
vi.mock('@/components/media/ModelViewer', () => ({
  default: (p: any) => <div data-testid="model" data-src={p.src} data-ios={p.iosSrc ?? ''} data-ar={String(p.ar)} />,
}))
vi.mock('@/components/media/SpinViewer', () => ({
  default: (p: any) => <div data-testid="spin" data-frames={p.frames.length} />,
}))

import MediaItemView, { MediaThumb, DocumentList, KIND_LABEL } from '@/components/media/MediaItemView'

const item = (over: Record<string, any> = {}): any => ({
  id: 'm1',
  kind: 'image',
  url: '/a.jpg',
  thumbnail_url: null,
  file_name: null,
  mime: null,
  size_bytes: null,
  alt: null,
  caption: null,
  metadata: {},
  ...over,
})

describe('MediaItemView', () => {
  it('renders an image by default', () => {
    render(<MediaItemView m={item({ alt: 'Front view' })} />)
    expect(screen.getByAltText('Front view')).toHaveAttribute('src', '/a.jpg')
  })

  it('renders a video with controls and poster', () => {
    const { container } = render(<MediaItemView m={item({ kind: 'video', url: '/v.mp4', thumbnail_url: '/v.jpg' })} />)
    const v = container.querySelector('video')!
    expect(v).toHaveAttribute('src', '/v.mp4')
    expect(v).toHaveAttribute('poster', '/v.jpg')
    expect(v.controls).toBe(true)
  })

  it('embeds a recognised external video and renders nothing for an unknown link', () => {
    const yt = render(
      <MediaItemView m={item({ kind: 'external_video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: 'Demo' })} />
    )
    expect(screen.getByTitle('Demo')).toHaveAttribute('src', expect.stringContaining('dQw4w9WgXcQ'))
    yt.unmount()
    const bad = render(<MediaItemView m={item({ kind: 'external_video', url: 'https://example.com/clip' })} />)
    expect(bad.container).toBeEmptyDOMElement()
  })

  it('renders audio with its caption', () => {
    const { container } = render(<MediaItemView m={item({ kind: 'audio', url: '/s.mp3', caption: 'Sound check' })} />)
    expect(screen.getByText('Sound check')).toBeInTheDocument()
    expect(container.querySelector('audio')).toHaveAttribute('src', '/s.mp3')
  })

  it('renders a document as a link with its name and size', () => {
    render(<MediaItemView m={item({ kind: 'document', url: '/d.pdf', file_name: 'manual.pdf', size_bytes: 2048 })} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/d.pdf')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('manual.pdf')).toBeInTheDocument()
    expect(screen.getByText('PDF 2 KB')).toBeInTheDocument()
  })

  it('loads the 3D and 360 viewers lazily with the item data', async () => {
    const m3 = render(
      <MediaItemView m={item({ kind: 'model_3d', url: '/m.glb', metadata: { usdz_url: '/m.usdz' } })} ar />
    )
    const model = await screen.findByTestId('model')
    expect(model).toHaveAttribute('data-src', '/m.glb')
    expect(model).toHaveAttribute('data-ios', '/m.usdz')
    expect(model).toHaveAttribute('data-ar', 'true')
    m3.unmount()
    render(<MediaItemView m={item({ kind: 'spin_360', metadata: { frames: ['a', 'b', 'c'] } })} />)
    expect(await screen.findByTestId('spin')).toHaveAttribute('data-frames', '3')
  })

  it('turns AR off when the model opts out', async () => {
    render(<MediaItemView m={item({ kind: 'model_3d', url: '/m.glb', metadata: { ar: false } })} ar />)
    expect(await screen.findByTestId('model')).toHaveAttribute('data-ar', 'false')
  })
})

describe('MediaThumb', () => {
  it('shows the still, with a kind badge for non-images', () => {
    const { container } = render(<MediaThumb m={item({ kind: 'video', thumbnail_url: '/t.jpg', alt: 'clip' })} />)
    expect(screen.getByAltText('clip')).toHaveAttribute('src', '/t.jpg')
    expect(container.querySelectorAll('svg').length).toBe(1)
  })

  it('falls back to the kind icon without a still', () => {
    const { container } = render(<MediaThumb m={item({ kind: 'audio' })} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

describe('DocumentList', () => {
  it('lists only documents with name and size', () => {
    render(
      <DocumentList
        items={[
          item({ id: '1', kind: 'document', url: '/a.pdf', caption: 'Datasheet', size_bytes: 3 * 1024 * 1024 }),
          item({ id: '2', kind: 'image' }),
          item({ id: '3', kind: 'document', url: '/b.pdf', file_name: 'warranty.pdf' }),
        ]}
        title="Downloads"
      />
    )
    expect(screen.getByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByText('Datasheet')).toBeInTheDocument()
    expect(screen.getByText('3.0 MB')).toBeInTheDocument()
    expect(screen.getByText('warranty.pdf')).toBeInTheDocument()
  })

  it('renders nothing without documents', () => {
    const { container } = render(<DocumentList items={[item()]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

it('labels every media kind', () => {
  expect(KIND_LABEL.spin_360).toBe('360° view')
})
