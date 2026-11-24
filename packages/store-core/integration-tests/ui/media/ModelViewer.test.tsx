import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// The real package registers a three.js web component; the import is all the component needs.
vi.mock('@google/model-viewer', () => ({}))

import ModelViewer from '@/components/media/ModelViewer'

describe('ModelViewer', () => {
  it('shows the poster behind a spinner until the web component is loaded, then the viewer', async () => {
    const { container } = render(<ModelViewer src="/m.glb" poster="/p.jpg" alt="Halo" />)
    const mv = await waitFor(() => {
      const el = container.querySelector('model-viewer')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    expect(mv).toHaveAttribute('src', '/m.glb')
    expect(mv).toHaveAttribute('alt', 'Halo')
    expect(mv).toHaveAttribute('poster', '/p.jpg')
    expect(mv).toHaveAttribute('camera-controls')
    expect(mv).not.toHaveAttribute('ar')
    expect(screen.queryByText('View in your space')).toBeNull()
  })

  it('offers the AR button and the iOS USDZ when ar is on', async () => {
    const { container } = render(<ModelViewer src="/m.glb" iosSrc="/m.usdz" ar />)
    await waitFor(() => expect(container.querySelector('model-viewer')).toBeTruthy())
    const mv = container.querySelector('model-viewer')!
    expect(mv).toHaveAttribute('ios-src', '/m.usdz')
    expect(mv).toHaveAttribute('ar')
    expect(mv).toHaveAttribute('alt', '3D model')
    expect(screen.getByRole('button', { name: 'View in your space' })).toBeInTheDocument()
  })

  it('renders the poster placeholder on the first paint', () => {
    const { container } = render(<ModelViewer src="/m.glb" poster="/p.jpg" alt="Halo" />)
    expect(container.querySelector('model-viewer')).toBeNull()
    expect(screen.getByAltText('Halo')).toHaveAttribute('src', '/p.jpg')
  })
})
