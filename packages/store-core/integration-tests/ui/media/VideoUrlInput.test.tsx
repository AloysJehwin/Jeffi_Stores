import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onPickVideo, onClose }: any) => (
    <div data-testid="gallery">
      <button onClick={() => onPickVideo({ url: 'https://cdn/v.mp4' })}>pick-video</button>
      <button onClick={onClose}>close-gallery</button>
    </div>
  ),
}))
vi.mock('@/components/admin/ai/AiVideoButton', () => ({
  default: ({ feature, onPick }: any) => <button onClick={() => onPick({ url: 'https://cdn/ai.mp4' })}>ai-{feature}</button>,
}))
const uploadGalleryVideo = vi.fn()
vi.mock('@/components/admin/media/media-upload', () => ({
  VIDEO_TYPES: ['video/mp4', 'video/webm'],
  VIDEO_MAX: 50 * 1024 * 1024,
  uploadGalleryVideo: (...a: unknown[]) => uploadGalleryVideo(...a),
}))

import VideoUrlInput from '@/components/admin/media/VideoUrlInput'

const file = (type: string, size = 100) => {
  const f = new File(['x'], 'clip', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('VideoUrlInput', () => {
  beforeEach(() => uploadGalleryVideo.mockReset())

  it('edits the URL as text', () => {
    const onChange = vi.fn()
    render(<VideoUrlInput value="" onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('https://… or upload'), { target: { value: 'https://x/v.mp4' } })
    expect(onChange).toHaveBeenCalledWith('https://x/v.mp4')
  })

  it('uploads a video and reports the new URL', async () => {
    uploadGalleryVideo.mockResolvedValue({ video: { url: 'https://cdn/new.mp4' } })
    const onChange = vi.fn()
    const { container } = render(<VideoUrlInput value="" onChange={onChange} />)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file('video/mp4')] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/new.mp4'))
  })

  it('rejects the wrong type and oversize files', async () => {
    const { container } = render(<VideoUrlInput value="" onChange={vi.fn()} />)
    const input = container.querySelector('input[type=file]')!
    fireEvent.change(input, { target: { files: [file('image/png')] } })
    expect(await screen.findByText('Use an MP4 or WebM video')).toBeInTheDocument()
    fireEvent.change(input, { target: { files: [file('video/mp4', 60 * 1024 * 1024)] } })
    expect(await screen.findByText('Video must be under 50 MB')).toBeInTheDocument()
    expect(uploadGalleryVideo).not.toHaveBeenCalled()
  })

  it('shows an upload failure', async () => {
    uploadGalleryVideo.mockResolvedValue({})
    const { container } = render(<VideoUrlInput value="" onChange={vi.fn()} />)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file('video/webm')] } })
    expect(await screen.findByText(/Cannot read properties of undefined/)).toBeInTheDocument()
  })

  it('picks a gallery video', () => {
    const onChange = vi.fn()
    render(<VideoUrlInput value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Gallery/ }))
    fireEvent.click(screen.getByText('pick-video'))
    expect(onChange).toHaveBeenCalledWith('https://cdn/v.mp4')
    expect(screen.queryByTestId('gallery')).not.toBeInTheDocument()
  })

  it('shows the AI button only when configured, and hides upload and gallery on request', () => {
    const onChange = vi.fn()
    const { rerender } = render(<VideoUrlInput value="" onChange={onChange} ai={{ feature: 'homepage_video' as never }} upload={false} gallery={false} />)
    expect(screen.queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gallery/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('ai-homepage_video'))
    expect(onChange).toHaveBeenCalledWith('https://cdn/ai.mp4')
    rerender(<VideoUrlInput value="" onChange={onChange} ai={false} />)
    expect(screen.queryByText('ai-homepage_video')).not.toBeInTheDocument()
  })
})
