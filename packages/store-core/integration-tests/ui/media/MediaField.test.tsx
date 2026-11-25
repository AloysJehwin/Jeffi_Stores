import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/components/admin/AdminImage', () => ({ default: ({ src }: any) => <img data-testid="img" src={src} alt="" /> }))
vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onConfirm, onPickVideo, onClose }: any) => (
    <div data-testid="gallery">
      <button onClick={() => onConfirm([{ image_url: 'https://cdn/g.png', blurhash: 'bh' }])}>pick-image</button>
      {onPickVideo && <button onClick={() => onPickVideo({ url: 'https://cdn/g.mp4', thumbnail_url: 'https://cdn/t.png' })}>pick-video</button>}
      <button onClick={onClose}>close-gallery</button>
    </div>
  ),
}))
vi.mock('@/components/admin/ai/AiMediaButton', () => ({
  default: ({ label, onPick }: any) => <button onClick={() => onPick({ url: 'https://cdn/ai.png', blurhash: null })}>{label}</button>,
}))
vi.mock('@/components/admin/ai/AiVideoButton', () => ({
  default: ({ label, onPick }: any) => <button onClick={() => onPick({ url: 'https://cdn/ai.mp4', posterUrl: 'https://cdn/p.png' })}>{label}</button>,
}))
const galleryUpload = vi.fn()
const uploadGalleryVideo = vi.fn()
vi.mock('@/components/admin/media/media-upload', () => ({
  IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  VIDEO_TYPES: ['video/mp4', 'video/webm'],
  IMAGE_MAX: 5 * 1024 * 1024,
  VIDEO_MAX: 50 * 1024 * 1024,
  galleryUpload: (...a: unknown[]) => galleryUpload(...a),
  uploadGalleryVideo: (...a: unknown[]) => uploadGalleryVideo(...a),
}))

import MediaField from '@/components/admin/media/MediaField'

const file = (type: string, size = 100) => {
  const f = new File(['x'], 'pic', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('MediaField', () => {
  beforeEach(() => {
    canWrite = true
    galleryUpload.mockReset()
    uploadGalleryVideo.mockReset()
  })

  it('shows the label, hint and an empty slot', () => {
    render(<MediaField label="Banner" hint="1200x400" value={{ image: null }} onChange={vi.fn()} />)
    expect(screen.getByText('Banner')).toBeInTheDocument()
    expect(screen.getByText('1200x400')).toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument()
  })

  it('uploads an image and saves the URL and blurhash', async () => {
    galleryUpload.mockResolvedValue({ url: 'https://cdn/new.png', blurhash: 'abc' })
    const onChange = vi.fn()
    const { container } = render(<MediaField label="Banner" value={{ image: null }} onChange={onChange} />)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file('image/png')] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ image: 'https://cdn/new.png', blurhash: 'abc' }))
    expect(showToast).toHaveBeenCalledWith('Image updated', 'success')
  })

  it('rejects a bad type, an oversize image and an upload error', async () => {
    const { container } = render(<MediaField label="Banner" value={{ image: null }} onChange={vi.fn()} />)
    const input = container.querySelector('input[type=file]')!
    fireEvent.change(input, { target: { files: [file('application/pdf')] } })
    expect(showToast).toHaveBeenCalledWith('Use a PNG, JPEG, WebP or GIF image', 'error')
    fireEvent.change(input, { target: { files: [file('image/png', 6 * 1024 * 1024)] } })
    expect(showToast).toHaveBeenCalledWith('Image must be under 5 MB', 'error')
    galleryUpload.mockRejectedValue(new Error('Disk full'))
    fireEvent.change(input, { target: { files: [file('image/png')] } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Disk full', 'error'))
  })

  it('uploads a video when allowed, keeping an existing image as the poster', async () => {
    uploadGalleryVideo.mockResolvedValue({ video: { url: 'https://cdn/v.mp4' }, poster: null })
    const onChange = vi.fn()
    const { container } = render(<MediaField label="Hero" allowVideo value={{ image: 'https://cdn/p.png' }} onChange={onChange} />)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file('video/mp4')] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ image: 'https://cdn/p.png', video: 'https://cdn/v.mp4' }))
    expect(showToast).toHaveBeenCalledWith('Video updated', 'success')
  })

  it('picks from the gallery, generates with AI, and clears the slot', () => {
    const onChange = vi.fn()
    render(<MediaField label="Hero" allowVideo value={{ image: 'https://cdn/p.png', video: 'https://cdn/v.mp4' }} onChange={onChange} />)
    expect(screen.getByText('Video')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Gallery/ }))
    fireEvent.click(screen.getByText('pick-image'))
    expect(onChange).toHaveBeenLastCalledWith({ image: 'https://cdn/g.png', video: 'https://cdn/v.mp4', blurhash: 'bh' })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ image: 'https://cdn/ai.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate video' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ video: 'https://cdn/ai.mp4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove video' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ video: null }))
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    expect(onChange).toHaveBeenLastCalledWith({ image: null, blurhash: null, video: null })
  })

  it('hides the controls without write permission or when disabled', () => {
    canWrite = false
    const { rerender } = render(<MediaField label="Banner" value={{ image: 'https://cdn/p.png' }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument()
    canWrite = true
    rerender(<MediaField label="Banner" disabled value={{ image: 'https://cdn/p.png' }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument()
  })
})
