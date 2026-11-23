import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// LogoUploader: file input + gallery/AI side buttons, POSTing to /api/admin/site-controls/logo.
// GalleryPicker and AiMediaButton are heavy admin children, mocked to light stand-ins.

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))

vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => <>{children}</>,
}))

// GalleryPicker: a stand-in that confirms one image so we can assert the copy-from-url POST.
vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onConfirm, onClose }: any) => (
    <div data-testid="gallery-picker">
      <button onClick={() => onConfirm([{ image_url: 'https://cdn/x.png' }])}>pick-gallery</button>
      <button onClick={onClose}>close-gallery</button>
    </div>
  ),
}))

vi.mock('@/components/admin/ai/AiMediaButton', () => ({
  default: ({ onPick }: any) => <button onClick={() => onPick({ url: 'https://cdn/ai.png' })}>AI</button>,
}))

import LogoUploader from '@/components/admin/site-controls/LogoUploader'

function okFetch(url = 'https://cdn/new.png') {
  return vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ url }) })
}

describe('LogoUploader', () => {
  beforeEach(() => showToast.mockReset())

  it('shows the current logo image when a URL is given', () => {
    render(<LogoUploader initialUrl="https://cdn/current.png" />)
    const img = screen.getByAltText('Store logo') as HTMLImageElement
    expect(img).toBeInTheDocument()
    expect(img.src).toContain('current.png')
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeInTheDocument()
  })

  it('shows the empty placeholder and Upload label with no URL', () => {
    render(<LogoUploader initialUrl="" />)
    expect(screen.getByText('No logo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeInTheDocument()
  })

  it('opens the gallery picker and copies the chosen image via a JSON POST', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<LogoUploader initialUrl="https://cdn/current.png" />)
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }))
    expect(screen.getByTestId('gallery-picker')).toBeInTheDocument()
    fireEvent.click(screen.getByText('pick-gallery'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ imageUrl: 'https://cdn/x.png' })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Logo updated', 'success'))
  })

  it('copies an AI-generated image when the AI button returns one', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<LogoUploader initialUrl="" storeName="Acme" />)
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ imageUrl: 'https://cdn/ai.png' })
  })

  it('toasts an error when the upload fails', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Too big' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<LogoUploader initialUrl="https://cdn/current.png" />)
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }))
    fireEvent.click(screen.getByText('pick-gallery'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too big', 'error'))
  })

  it('closes the gallery picker without a request on cancel', () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<LogoUploader initialUrl="https://cdn/current.png" />)
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }))
    fireEvent.click(screen.getByText('close-gallery'))
    expect(screen.queryByTestId('gallery-picker')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
