import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'

let galleryPick: any[] = []
vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onConfirm, onClose }: any) => (
    <div data-testid="gallery">
      <button onClick={() => onConfirm(galleryPick)}>confirm-gallery</button>
      <button onClick={onClose}>close-gallery</button>
    </div>
  ),
}))
vi.mock('@/components/admin/ai/AiMediaButton', () => ({
  default: ({ feature, sizes, onPick }: any) => (
    <button onClick={() => onPick({ url: 'https://cdn.test/ai.png' })}>
      ai:{feature}:{sizes.map((s: any) => s.key).join(',')}
    </button>
  ),
}))

import ImageUrlInput, { uploadImage } from '@/components/admin/ImageUrlInput'

const res = (ok: boolean, body: unknown) => ({ ok, json: async () => body })

function Controlled(props: Partial<React.ComponentProps<typeof ImageUrlInput>> & { initial?: string; spy?: any }) {
  const [v, setV] = useState(props.initial ?? '')
  return (
    <ImageUrlInput
      {...props}
      value={v}
      onChange={u => {
        props.spy?.(u)
        setV(u)
      }}
    />
  )
}

describe('uploadImage', () => {
  it('posts the raw file with name header and returns the CDN url', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue(res(true, { url: 'https://cdn.test/a.png' }))
    vi.stubGlobal('fetch', f)
    const file = new File(['x'], 'my pic.png', { type: 'image/png' })
    await expect(uploadImage(file)).resolves.toBe('https://cdn.test/a.png')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/admin/uploads/image')
    expect(init.body).toBe(file)
    expect(init.headers).toEqual({ 'Content-Type': 'image/png', 'X-File-Name': 'my%20pic.png' })
  })

  it('throws the server error or a default', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(false, { error: 'Too big' })))
    await expect(uploadImage(new File(['x'], 'a.png'))).rejects.toThrow('Too big')
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(true, {})))
    await expect(uploadImage(new File(['x'], 'a.png'))).rejects.toThrow('Upload failed')
  })
})

describe('ImageUrlInput', () => {
  beforeEach(() => {
    galleryPick = []
  })

  it('lets the user paste a url and shows a preview for http urls only', () => {
    const spy = vi.fn()
    const { container } = render(<Controlled spy={spy} />)
    const input = screen.getByPlaceholderText('https://… or upload')
    expect(container.querySelector('img')).toBeNull()
    fireEvent.change(input, { target: { value: 'https://cdn.test/x.png' } })
    expect(spy).toHaveBeenCalledWith('https://cdn.test/x.png')
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/x.png')
    fireEvent.change(input, { target: { value: 'not a url' } })
    expect(container.querySelector('img')).toBeNull()
  })

  it('hides the preview when preview is false and mirrors the value into a hidden input', () => {
    const { container } = render(<Controlled initial="https://cdn.test/x.png" preview={false} name="logo" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('input[type="hidden"][name="logo"]')).toHaveValue('https://cdn.test/x.png')
  })

  it('uploads a chosen file and puts the CDN url in the field', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(true, { url: 'https://cdn.test/up.png' })))
    const { container } = render(<Controlled />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByPlaceholderText('https://… or upload')).toHaveValue('https://cdn.test/up.png'))
  })

  it('uses a custom upload endpoint', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue(res(true, { url: 'u' }))
    vi.stubGlobal('fetch', f)
    const { container } = render(<Controlled endpoint="/api/custom/up" />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.png')] } })
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(f.mock.calls[0][0]).toBe('/api/custom/up')
  })

  it('shows the upload error and leaves the field unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(false, { error: 'Unsupported type' })))
    const { container } = render(<Controlled />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.bmp')] } })
    expect(await screen.findByText('Unsupported type')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://… or upload')).toHaveValue('')
  })

  it('shows Uploading… and disables the button while busy', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>(() => new Promise(() => {})))
    const { container } = render(<Controlled />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.png')] } })
    expect(await screen.findByRole('button', { name: /Uploading/ })).toBeDisabled()
  })

  it('shows no Gallery or AI buttons by default', () => {
    render(<Controlled />)
    expect(screen.queryByRole('button', { name: /Gallery/ })).toBeNull()
    expect(screen.queryByText(/^ai:/)).toBeNull()
  })

  it('gallery: picks an image into the field', async () => {
    galleryPick = [{ id: 'g1', image_url: 'https://cdn.test/g.jpg', mime_type: 'image/jpeg' }]
    render(<Controlled gallery />)
    fireEvent.click(screen.getByRole('button', { name: /Gallery/ }))
    fireEvent.click(screen.getByText('confirm-gallery'))
    await waitFor(() => expect(screen.getByPlaceholderText('https://… or upload')).toHaveValue('https://cdn.test/g.jpg'))
    expect(screen.queryByTestId('gallery')).toBeNull()
  })

  it('gallery: closes without picking', () => {
    render(<Controlled gallery />)
    fireEvent.click(screen.getByRole('button', { name: /Gallery/ }))
    fireEvent.click(screen.getByText('close-gallery'))
    expect(screen.queryByTestId('gallery')).toBeNull()
  })

  it('png fields copy a WebP gallery pick as PNG', async () => {
    galleryPick = [{ id: 'g1', image_url: 'https://cdn.test/g.webp', mime_type: 'image/webp' }]
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue(res(true, { url: 'https://cdn.test/g.png' }))
    vi.stubGlobal('fetch', f)
    render(<Controlled gallery png />)
    fireEvent.click(screen.getByRole('button', { name: /Gallery/ }))
    fireEvent.click(screen.getByText('confirm-gallery'))
    await waitFor(() => expect(screen.getByPlaceholderText('https://… or upload')).toHaveValue('https://cdn.test/g.png'))
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ imageUrl: 'https://cdn.test/g.webp' })
  })

  it('png fields show the copy error', async () => {
    galleryPick = [{ id: 'g1', image_url: 'https://cdn.test/g.webp', mime_type: 'image/webp' }]
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(res(false, {})))
    render(<Controlled gallery png />)
    fireEvent.click(screen.getByRole('button', { name: /Gallery/ }))
    fireEvent.click(screen.getByText('confirm-gallery'))
    expect(await screen.findByText('Could not copy the image')).toBeInTheDocument()
  })

  it('ai: adds the gallery and AI buttons with the requested sizes, and takes the AI result', () => {
    const spy = vi.fn()
    render(<Controlled ai={{ feature: 'email_hero' as any, size: ['wide', 'square', 'bogus'] }} spy={spy} />)
    expect(screen.getByRole('button', { name: /Gallery/ })).toBeInTheDocument()
    const ai = screen.getByText('ai:email_hero:wide,square')
    fireEvent.click(ai)
    expect(spy).toHaveBeenCalledWith('https://cdn.test/ai.png')
  })
})
