import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/x' }))
vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="Category" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
let hasDrive = false
vi.mock('@/contexts/AdminScopesContext', () => ({ useHasScope: () => hasDrive }))
const confirmFn = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))
const publish = vi.fn()
vi.mock('@/components/admin/drive/api', () => ({ driveApi: { publish: (...a: any[]) => publish(...a) } }))
const pickDrive = vi.fn()
vi.mock('@/components/admin/drive/DrivePicker', () => ({ useDrivePicker: () => ({ pick: pickDrive, node: null }) }))
const toast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast: toast }) }))

import GalleryPicker from '@/components/admin/GalleryPicker'

const img = (id: string, o: any = {}) => ({ id, image_url: `/full/${id}.png`, thumbnail_url: `/thumb/${id}.png`, file_name: `${id}.png`, ...o })
const vid = (id: string, o: any = {}) => ({ id, url: `/v/${id}.mp4`, mime: 'video/mp4', duration_seconds: 12.4, width: 1, height: 1, aspect: '16:9', thumbnail_url: `/vt/${id}.png`, blurhash: null, label: `Clip ${id}`, source: 'upload', prompt_text: null, ...o })

const fetchMock = vi.fn()
const respond = (images = [img('a'), img('b'), img('c')], total = images.length, videos: any[] = []) =>
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/categories')) return { ok: true, json: () => Promise.resolve({ categories: [{ id: 'k1', name: 'Bolts' }] }) }
    if (url.startsWith('/api/admin/media/videos')) return { ok: true, json: () => Promise.resolve({ videos, total: videos.length }) }
    return { ok: true, json: () => Promise.resolve({ images, total }) }
  })

beforeEach(() => {
  fetchMock.mockReset()
  confirmFn.mockReset()
  publish.mockReset()
  pickDrive.mockReset()
  toast.mockReset()
  hasDrive = false
  respond()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('GalleryPicker images', () => {
  it('shows a loading spinner, then the gallery images with the dialog title', async () => {
    render(<GalleryPicker onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Choose from Gallery' })).toBeInTheDocument()
    expect(await screen.findByAltText('a.png')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/gallery?page=1&limit=24'))).toBe(true)
  })

  it('multi mode: numbers the selection in order, caps at maxSelect and confirms in order', async () => {
    const onConfirm = vi.fn()
    render(<GalleryPicker onConfirm={onConfirm} onClose={() => {}} maxSelect={2} />)
    await screen.findByAltText('a.png')
    expect(screen.getByRole('button', { name: 'Add Images' })).toBeDisabled()
    fireEvent.click(screen.getByAltText('c.png'))
    fireEvent.click(screen.getByAltText('a.png'))
    fireEvent.click(screen.getByAltText('b.png'))
    const badges = Array.from(document.querySelectorAll('div.rounded-full')).map(d => d.textContent)
    expect(badges.sort()).toEqual(['1', '2'])
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 Images' }))
    expect(onConfirm.mock.calls[0][0].map((i: any) => i.id)).toEqual(['c', 'a'])
  })

  it('clicking a selected image again unselects it', async () => {
    render(<GalleryPicker onConfirm={() => {}} onClose={() => {}} />)
    await screen.findByAltText('a.png')
    fireEvent.click(screen.getByAltText('a.png'))
    expect(screen.getByRole('button', { name: 'Add 1 Image' })).toBeEnabled()
    fireEvent.click(screen.getByAltText('a.png'))
    expect(screen.getByRole('button', { name: 'Add Images' })).toBeDisabled()
  })

  it('single mode confirms immediately with one image and has no footer', async () => {
    const onConfirm = vi.fn()
    render(<GalleryPicker mode="single" onConfirm={onConfirm} onClose={() => {}} />)
    await screen.findByAltText('b.png')
    expect(screen.queryByRole('button', { name: 'Add Images' })).toBeNull()
    fireEvent.click(screen.getByAltText('b.png'))
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' })])
  })

  it('searches on the server after a pause and by category', async () => {
    render(<GalleryPicker onConfirm={() => {}} onClose={() => {}} />)
    await screen.findByAltText('a.png')
    fetchMock.mockClear()
    respond([img('z')])
    fireEvent.change(screen.getByPlaceholderText('Search by name…'), { target: { value: ' bolt ' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('search=bolt'))).toBe(true))
    expect(await screen.findByAltText('z.png')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bolts' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'k1' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('category=k1'))).toBe(true))
  })

  it('says so when nothing matches, and when the gallery is empty', async () => {
    respond([])
    const { unmount } = render(<GalleryPicker onConfirm={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('No images in gallery yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search by name…'), { target: { value: 'zzz' } })
    expect(await screen.findByText('No images match your filters.')).toBeInTheDocument()
    unmount()
  })

  it('loads more images with Load more', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/categories')) return { ok: true, json: () => Promise.resolve({ categories: [] }) }
      const page = new URL(url, 'http://x').searchParams.get('page')
      return { ok: true, json: () => Promise.resolve({ images: page === '1' ? [img('a'), img('b')] : [img('c')], total: 3 }) }
    })
    render(<GalleryPicker onConfirm={() => {}} onClose={() => {}} pageSize={2} />)
    await screen.findByAltText('a.png')
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByAltText('c.png')).toBeInTheDocument()
  })

  it('Cancel closes', async () => {
    const onClose = vi.fn()
    render(<GalleryPicker onConfirm={() => {}} onClose={onClose} />)
    await screen.findByAltText('a.png')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('GalleryPicker videos', () => {
  it('has an Images | Videos tab; picking a video calls onPickVideo', async () => {
    respond([img('a')], 1, [vid('v1'), vid('v2', { thumbnail_url: null, label: null, source: 'ai', duration_seconds: null, aspect: null })])
    const onPickVideo = vi.fn()
    render(<GalleryPicker onConfirm={() => {}} onClose={() => {}} onPickVideo={onPickVideo} />)
    await screen.findByAltText('a.png')
    fireEvent.click(screen.getByRole('tab', { name: 'Videos' }))
    expect(await screen.findByText('Clip v1')).toBeInTheDocument()
    expect(screen.getByText('12s')).toBeInTheDocument()
    expect(screen.getByText('AI video')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Images' })).toBeNull()
    fireEvent.click(screen.getByText('Clip v1'))
    expect(onPickVideo).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }))
  })

  it('videosOnly shows only videos, with the video title and an empty message', async () => {
    respond([], 0, [])
    render(<GalleryPicker videosOnly onPickVideo={() => {}} onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Choose a video' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(await screen.findByText('No videos in gallery yet.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/gallery?'))).toBe(false)
  })
})

describe('GalleryPicker from Drive', () => {
  it('needs the drive scope', async () => {
    render(<GalleryPicker onConfirm={() => {}} onClose={() => {}} />)
    await screen.findByAltText('a.png')
    expect(screen.queryByRole('button', { name: /From Drive/ })).toBeNull()
  })

  it('publishes the picked Drive images to the gallery after confirming, then returns them', async () => {
    hasDrive = true
    pickDrive.mockResolvedValue([{ id: 'f1', name: 'x.png' }])
    confirmFn.mockResolvedValue(true)
    publish.mockResolvedValue({ kind: 'image', id: 'g1', url: '/g1.png', row: img('g1') })
    const onConfirm = vi.fn()
    render(<GalleryPicker onConfirm={onConfirm} onClose={() => {}} />)
    await screen.findByAltText('a.png')
    fireEvent.click(screen.getByRole('button', { name: /From Drive/ }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalled())
    expect(confirmFn.mock.calls[0][0].title).toBe('Make public?')
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ id: 'g1' })]))
    expect(publish).toHaveBeenCalledWith('f1')
  })

  it('does nothing when the confirmation is declined, and toasts a publish failure', async () => {
    hasDrive = true
    pickDrive.mockResolvedValue([{ id: 'f1', name: 'x.png' }])
    confirmFn.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    publish.mockRejectedValue(new Error('Not allowed'))
    const onConfirm = vi.fn()
    render(<GalleryPicker onConfirm={onConfirm} onClose={() => {}} />)
    await screen.findByAltText('a.png')
    fireEvent.click(screen.getByRole('button', { name: /From Drive/ }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalledTimes(1))
    expect(publish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /From Drive/ }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Not allowed', 'error'))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
