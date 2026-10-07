import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'

const fetchStreamUrl = vi.fn()
vi.mock('@/components/vault/stream-client', () => ({ fetchStreamUrl: (...a: any[]) => fetchStreamUrl(...a) }))

import MediaViewer from '@/components/vault/MediaViewer'

let n = 0
beforeEach(() => {
  n = 0
  fetchStreamUrl.mockReset()
  fetchStreamUrl.mockImplementation(async () => ({ url: `https://s3.test/v?sig=${++n}`, disposition: 'inline', kind: 'video', mimeType: 'video/mp4' }))
})

async function mountVideo() {
  const { container } = render(<MediaViewer fileId="f1" kind="video" />)
  await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
  return container.querySelector('video') as HTMLVideoElement
}

describe('MediaViewer', () => {
  it('re-signs on a stream error and resumes at the same position', async () => {
    const video = await mountVideo()
    expect(video.getAttribute('src')).toContain('sig=1')
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined)
    fireEvent.playing(video)
    video.currentTime = 1234
    await act(async () => void fireEvent.error(video))
    await waitFor(() => expect(video.getAttribute('src')).toContain('sig=2'))
    video.currentTime = 0
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(1234)
    expect(play).toHaveBeenCalled()
  })

  it('re-signs before a seek once the URL is stale, but not while fresh', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const video = await mountVideo()
    fireEvent.seeking(video)
    expect(fetchStreamUrl).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1_000_000 + 80_000)
    await act(async () => void fireEvent.seeking(video))
    await waitFor(() => expect(video.getAttribute('src')).toContain('sig=2'))
    now.mockRestore()
  })

  it('gives up after repeated failures without a successful play', async () => {
    const video = await mountVideo()
    for (let i = 0; i < 4; i++) {
      await act(async () => void fireEvent.error(video))
    }
    expect(await screen.findByText('Could not load this file.')).toBeTruthy()
  })
})
