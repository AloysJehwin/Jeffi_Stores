import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite, useCanUseAi: () => false }))
vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onConfirm, onPickVideo, onClose }: any) => (
    <div data-testid="gallery">
      <button onClick={() => onConfirm([{ id: 'g1' }])}>gallery-pick-image</button>
      <button onClick={() => onPickVideo({ id: 'gv1', url: 'https://cdn/v.mp4', thumbnail_url: null, mime: 'video/mp4', label: 'clip' })}>gallery-pick-video</button>
      <button onClick={onClose}>gallery-close</button>
    </div>
  ),
}))
vi.mock('@/components/admin/ai/AiMediaButton', () => ({ default: () => null }))
vi.mock('@/components/admin/ai/AiVideoButton', () => ({ default: () => null }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="doc-type" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/media/media-upload', () => ({
  galleryUpload: vi.fn(),
  readVideoFile: vi.fn().mockResolvedValue({ durationSec: 5 }),
  uploadGalleryVideo: vi.fn(),
}))
vi.mock('@/components/media/MediaItemView', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/media/MediaItemView')>()
  return { ...actual, default: ({ m }: any) => <div data-testid="item-view">{m.url}</div>, MediaThumb: ({ m }: any) => <i data-testid="thumb">{m.url}</i> }
})

import MediaManager from '@/components/admin/product-form/MediaManager'
import { DEFAULT_MEDIA_LIMITS } from '@/lib/catalog/product-media-shared'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'image', url: `https://cdn/${id}.png`, thumbnail_url: null, s3_key: null, s3_thumbnail_key: null, file_name: null, mime: 'image/png', size_bytes: null, width: null, height: null,
  duration_seconds: null, alt: null, caption: null, sort_order: 0, is_primary: false, status: 'ready', metadata: {}, product_id: 'p1', variant_id: null, sub_variant_id: null, ...over,
})
const variants = [{ id: 'v1', name: 'Red', useOwn: false, subs: [{ id: 'sv1', name: 'Large', useOwn: true }] }]

function setup(over: Record<string, unknown> = {}) {
  const props = {
    productId: 'p1', initial: { items: [item(U1, { is_primary: true }), item(U2, { sort_order: 1 })], own_sub: {} }, variants, limits: DEFAULT_MEDIA_LIMITS,
    scope: {}, onScope: vi.fn(), onVariantOwn: vi.fn(), onChange: vi.fn(), onCountsChange: vi.fn(), ...over,
  }
  const view = render(<form data-testid="form"><MediaManager {...(props as any)} /></form>)
  return { props, ...view }
}

describe('MediaManager', () => {
  beforeEach(() => {
    canWrite = true
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>())
  })

  it('shows the scope picker with counts and the item grid', () => {
    const { props } = setup()
    expect(screen.getByRole('navigation', { name: 'Media scope' })).toBeInTheDocument()
    expect(screen.getByText('2/' + DEFAULT_MEDIA_LIMITS.maxPerScope + ' items')).toBeInTheDocument()
    expect(screen.getAllByTestId('thumb')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Red/ })).toHaveTextContent('inherits')
    expect(props.onCountsChange).toHaveBeenCalledWith({ product: 2 })
    fireEvent.click(screen.getByRole('button', { name: /Large/ }))
    expect(props.onScope).toHaveBeenCalledWith({ variantId: 'v1', subVariantId: 'sv1' })
  })

  it('stages nothing until edited, then writes the _media payload', async () => {
    const { props, container } = setup()
    expect(container.querySelector('input[name=_media]')).toBeNull()
    fireEvent.click(screen.getAllByTitle('Remove')[0])
    const payload = JSON.parse((container.querySelector('input[name=_media]') as HTMLInputElement).value)
    expect(payload.items.map((i: any) => i.id)).toEqual([U2])
    await waitFor(() => expect(props.onChange).toHaveBeenCalled())
  })

  it('sets a primary, reorders and filters by media kind', () => {
    const { container } = setup({ initial: { items: [item(U1, { is_primary: true }), item(U2, { sort_order: 1 }), item('33333333-3333-4333-8333-333333333333', { kind: 'document', sort_order: 2, url: 'https://cdn/d.pdf' })], own_sub: {} } })
    fireEvent.click(screen.getAllByTitle('Primary')[1])
    const staged = () => JSON.parse((container.querySelector('input[name=_media]') as HTMLInputElement).value).items
    expect(staged().find((i: any) => i.id === U2).is_primary).toBe(true)
    expect(staged().find((i: any) => i.id === U1).is_primary).toBe(false)
    fireEvent.click(screen.getAllByTitle('Move later')[0])
    expect(staged().find((i: any) => i.id === U1).sort_order).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /^Documents? 1$|Document.* 1/ }))
    expect(screen.getAllByTestId('thumb')).toHaveLength(1)
  })

  it('adds a YouTube video link and rejects an invalid one', () => {
    const { container } = setup({ initial: { items: [], own_sub: {} } })
    fireEvent.click(screen.getByRole('button', { name: /Video link/ }))
    const input = screen.getByPlaceholderText(/youtube\.com/)
    fireEvent.change(input, { target: { value: 'nonsense' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a YouTube or Vimeo link')
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const staged = JSON.parse((container.querySelector('input[name=_media]') as HTMLInputElement).value).items
    expect(staged[0]).toMatchObject({ kind: 'external_video', metadata: { provider: 'youtube' } })
  })

  it('uploads an image through the media API', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ item: { url: 'https://cdn/up.png', mime: 'image/png' } }) } as never)
    const { container } = setup({ initial: { items: [], own_sub: {} } })
    const file = new File(['x'], 'pic.png', { type: 'image/png' })
    fireEvent.change(container.querySelectorAll('input[type=file]')[0], { target: { files: [file] } })
    await waitFor(() => expect(container.querySelector('input[name=_media]')).toBeInTheDocument())
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/admin/products/p1/media')
    const staged = JSON.parse((container.querySelector('input[name=_media]') as HTMLInputElement).value).items
    expect(staged[0]).toMatchObject({ kind: 'image', url: 'https://cdn/up.png', is_primary: true })
  })

  it('rejects an unsupported file type', async () => {
    const { container } = setup({ initial: { items: [], own_sub: {} } })
    fireEvent.change(container.querySelectorAll('input[type=file]')[0], { target: { files: [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })] } })
    expect(await screen.findByText('a.exe: unsupported file type')).toBeInTheDocument()
  })

  it('adds from the gallery (image via the API, video directly)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ item: { url: 'https://cdn/g.png' } }) } as never)
    const { container } = setup({ initial: { items: [], own_sub: {} } })
    fireEvent.click(screen.getByRole('button', { name: /From gallery/ }))
    fireEvent.click(screen.getByText('gallery-pick-video'))
    await waitFor(() => expect(container.querySelector('input[name=_media]')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /From gallery/ }))
    fireEvent.click(screen.getByText('gallery-pick-image'))
    await waitFor(() => expect(JSON.parse((container.querySelector('input[name=_media]') as HTMLInputElement).value).items).toHaveLength(2))
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ gallery_image_id: 'g1' })
  })

  it('edits alt text and caption in the item editor', () => {
    const { container } = setup()
    fireEvent.click(screen.getAllByTitle('Image')[0])
    expect(screen.getByTestId('item-view')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Describe it for screen readers'), { target: { value: 'A drill' } })
    const staged = JSON.parse((container.querySelector('input[name=_media]') as HTMLInputElement).value).items
    expect(staged.find((i: any) => i.id === U1).alt).toBe('A drill')
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(screen.queryByTestId('item-view')).not.toBeInTheDocument()
  })

  it('shows inherited media and lets the variant switch to its own', () => {
    const { props } = setup({ scope: { variantId: 'v1' } })
    expect(screen.getByText(/Shows the product's media/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Use own media/ }))
    expect(props.onVariantOwn).toHaveBeenCalledWith('v1', true)
  })

  it('copies the scope into another and turns on its own media', () => {
    const { props, container } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Copy all to/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Red' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(props.onVariantOwn).toHaveBeenCalledWith('v1', true)
    const staged = JSON.parse((container.querySelector('input[name=_media]') as HTMLInputElement).value).items
    expect(staged.filter((i: any) => i.variant_id === 'v1')).toHaveLength(2)
  })

  it('is read only without write permission', () => {
    canWrite = false
    setup()
    expect(screen.getByRole('button', { name: /Upload/ })).toBeDisabled()
    expect(screen.getAllByTitle('Remove')[0]).toBeDisabled()
  })
})
