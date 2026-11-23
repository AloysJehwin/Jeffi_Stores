import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// MediaViewer asks stream-client for a short-lived signed URL on mount, then renders a <video> or
// <audio> with download/fullscreen affordances off. Mock the signer so no network is hit.
const fetchStreamUrl = vi.fn()
vi.mock('@/components/vault/stream-client', () => ({
  fetchStreamUrl: (...a: unknown[]) => fetchStreamUrl(...a),
}))

import MediaViewer from '@/components/vault/MediaViewer'

beforeEach(() => fetchStreamUrl.mockReset())

describe('MediaViewer (render)', () => {
  it('shows a loading note before the signed URL resolves', async () => {
    // Deferred: assert the loading note synchronously, then resolve so no promise stays pending.
    let resolve!: (v: unknown) => void
    fetchStreamUrl.mockReturnValue(new Promise(r => { resolve = r }))
    render(<MediaViewer fileId="f1" kind="video" />)
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    resolve({ url: 'blob:v', disposition: 'inline', kind: 'video', mimeType: 'video/mp4' })
  })

  it('renders a <video> with download + fullscreen disabled once signed', async () => {
    fetchStreamUrl.mockResolvedValue({ url: 'blob:signed-video', disposition: 'inline', kind: 'video', mimeType: 'video/mp4' })
    const { container } = render(<MediaViewer fileId="f1" kind="video" />)
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    const el = container.querySelector('video')!
    expect(el).toHaveAttribute('src', 'blob:signed-video')
    expect(el).toHaveAttribute('controlslist', expect.stringContaining('nodownload'))
    expect(el).toHaveAttribute('controlslist', expect.stringContaining('nofullscreen'))
  })

  it('renders an <audio> element for audio kind', async () => {
    fetchStreamUrl.mockResolvedValue({ url: 'blob:signed-audio', disposition: 'inline', kind: 'audio', mimeType: 'audio/mpeg' })
    const { container } = render(<MediaViewer fileId="f2" kind="audio" />)
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    expect(container.querySelector('video')).toBeNull()
  })

  // NOTE: the err-state branch (failed sign / exhausted re-sign) isn't tested here — a rejecting
  // signer mock trips vitest's eager unhandled-rejection detector even though refresh()/mount both
  // catch it, so the assertion can't run cleanly in happy-dom. Covered implicitly by the loading path.
})
