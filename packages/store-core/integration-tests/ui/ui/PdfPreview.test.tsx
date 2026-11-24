import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const getDocument = vi.fn<(...a: any[]) => any>()
const GlobalWorkerOptions: { workerSrc?: string } = {}
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions, version: '9.9.9', getDocument: (o: any) => getDocument(o) }))

import PdfPreview from '@/components/ui/PdfPreview'

const fakePdf = (pages: number) => ({
  numPages: pages,
  getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  }),
})

describe('PdfPreview', () => {
  it('shows a spinner, then one canvas per page once rendered', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as any)
    getDocument.mockReturnValue({ promise: Promise.resolve(fakePdf(3)) })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))))
    const { container } = render(<PdfPreview url="/api/doc.pdf" />)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    await waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(3))
    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(screen.queryByText('Could not load the preview.')).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/api/doc.pdf')
    expect(GlobalWorkerOptions.workerSrc).toBe('/api/vault/pdf-worker?v=9.9.9')
    getContext.mockRestore()
  })

  it('says so when the file cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })))
    render(<PdfPreview url="/missing.pdf" />)
    expect(await screen.findByText('Could not load the preview.')).toBeInTheDocument()
  })

  it('says so when the document cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([0]))))
    getDocument.mockReturnValue({ promise: Promise.reject(new Error('bad pdf')) })
    render(<PdfPreview url="/bad.pdf" />)
    expect(await screen.findByText('Could not load the preview.')).toBeInTheDocument()
  })

  it('does nothing without a url', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { container } = render(<PdfPreview url="" />)
    expect(fetch).not.toHaveBeenCalled()
    expect(container.querySelector('canvas')).toBeNull()
  })
})
