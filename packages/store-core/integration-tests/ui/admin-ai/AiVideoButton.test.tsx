import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let perms = { write: true, ai: true }
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => perms.write, useCanUseAi: () => perms.ai }))
vi.mock('@/components/admin/ai/PresetChipRow', () => ({ default: ({ onPick }: any) => <button onClick={() => onPick('A preset scene')}>preset</button> }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onConfirm, onClose }: any) => (
    <div data-testid="gallery">
      <button onClick={() => onConfirm([{ image_url: 'https://cdn/g.png' }])}>pick-image</button>
      <button onClick={onClose}>close-gallery</button>
    </div>
  ),
}))
vi.mock('@/components/ui/Select', () => ({
  default: ({ value, options, onChange, ...rest }: any) => (
    <select aria-label={rest['aria-label']} value={value} onChange={e => onChange(isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import AiVideoButton from '@/components/admin/ai/AiVideoButton'

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('AiVideoButton', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    perms = { write: true, ai: true }
    fetchMock = vi.fn<(...a: any[]) => any>(async (url: string) => (url.startsWith('/api/admin/ai/price') ? json(200, { priceInr: 2 }) : json(200, {})))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.useRealTimers())

  it('renders nothing without write permission or the AI plan', () => {
    perms.write = false
    const { container, rerender } = render(<AiVideoButton onPick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    perms = { write: true, ai: false }
    rerender(<AiVideoButton onPick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the dialog with the price estimate and the default prompt', async () => {
    render(<AiVideoButton feature="homepage_video" defaultPrompt="Spinning drill" label="Generate video" onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Generate video/ }))
    expect(screen.getByDisplayValue('Spinning drill')).toBeInTheDocument()
    expect(await screen.findByTestId('ai-price')).toHaveTextContent('About ₹8.00 for 4s')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ai/price?feature=homepage_video')
  })

  it('asks for a prompt before generating', async () => {
    render(<AiVideoButton onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /AI video/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Describe the scene (a sentence works).')).toBeInTheDocument()
  })

  it('starts a job, polls it to completion and hands back the video', async () => {
    const onPick = vi.fn()
    render(<AiVideoButton defaultPrompt="Drill spinning" defaultImageUrl="https://cdn/ref.png" usageRef="slide-1" onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /AI video/ }))
    await screen.findByTestId('ai-price')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return json(200, { jobId: 'j1', usageId: 'u1', estimatedPriceInr: 8 })
      return json(200, { status: 'done', videoUrl: 'https://cdn/v.mp4', galleryVideoId: 'gv1', durationSec: 4, priceInr: 8, posterUrl: 'https://cdn/p.png' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByText(/Queued/)).toBeInTheDocument())
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ feature: 'social_video', prompt: 'Drill spinning', imageUrl: 'https://cdn/ref.png', aspect: '9:16', durationSec: 4, ref: 'slide-1' })
    await act(async () => { vi.advanceTimersByTime(6100) })
    const use = await screen.findByRole('button', { name: 'Use this' })
    expect(screen.getByTestId('ai-charge')).toHaveTextContent('Charged ₹8.00')
    fireEvent.click(use)
    expect(onPick).toHaveBeenCalledWith({ url: 'https://cdn/v.mp4', galleryVideoId: 'gv1', durationSec: 4, posterUrl: 'https://cdn/p.png' })
    expect(showToast).toHaveBeenCalledWith('Video added', 'success')
  })

  it('shows the wallet top-up notice on a 402', async () => {
    render(<AiVideoButton defaultPrompt="Drill spinning" onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /AI video/ }))
    fetchMock.mockResolvedValueOnce(json(402, { balanceInr: 1, neededInr: 8 }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(/Wallet balance ₹1.00 is below the ₹8.00 needed/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Top up' }).getAttribute('href')).toContain('/admin/wallet')
  })

  it('shows a start error and a failed job', async () => {
    render(<AiVideoButton defaultPrompt="Drill spinning" onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /AI video/ }))
    fetchMock.mockResolvedValueOnce(json(500, { error: 'Provider down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Provider down')).toBeInTheDocument()
  })

  it('uploads a pasted image URL to the gallery and picks from the gallery', async () => {
    render(<AiVideoButton onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /AI video/ }))
    fireEvent.click(screen.getByRole('button', { name: 'preset' }))
    expect(screen.getByDisplayValue('A preset scene')).toBeInTheDocument()
    const upload = screen.getByRole('button', { name: 'Upload' })
    expect(upload).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://ext/x.png' } })
    fetchMock.mockResolvedValueOnce(json(200, { image_url: 'https://cdn/uploaded.png' }))
    fireEvent.click(upload)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Added to Gallery', 'success'))
    expect(screen.getByDisplayValue('https://cdn/uploaded.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pick from Gallery' }))
    fireEvent.click(screen.getByText('pick-image'))
    expect(screen.getByDisplayValue('https://cdn/g.png')).toBeInTheDocument()
  })
})
