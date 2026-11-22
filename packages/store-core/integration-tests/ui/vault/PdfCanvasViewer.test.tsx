import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// PdfCanvasViewer dynamically imports pdfjs-dist and renders each page to <canvas>. We mock the
// signer and pdfjs so the async render path runs in happy-dom: assert the loading note, the eventual
// ready state (canvases appended), and the error branch when rendering throws.
const fetchStreamUrl = vi.fn()
vi.mock('@/components/vault/stream-client', () => ({
  fetchStreamUrl: (...a: unknown[]) => fetchStreamUrl(...a),
}))

const getDocument = vi.fn()
vi.mock('pdfjs-dist', () => ({
  version: '4.0.0',
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...a: unknown[]) => getDocument(...a),
}))

import PdfCanvasViewer from '@/components/vault/PdfCanvasViewer'

function fakeDoc(numPages: number) {
  return {
    numPages,
    getPage: vi.fn().mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    }),
  }
}

beforeEach(() => {
  fetchStreamUrl.mockReset()
  getDocument.mockReset()
})

describe('PdfCanvasViewer (render)', () => {
  it('shows a loading note on first paint', () => {
    fetchStreamUrl.mockReturnValue(new Promise(() => {}))
    render(<PdfCanvasViewer fileId="f1" pageCount={2} />)
    expect(screen.getByText(/Loading document/)).toBeInTheDocument()
  })

  it('clears the loading note and shows no error once pages render', async () => {
    fetchStreamUrl.mockResolvedValue({ url: 'blob:pdf' })
    getDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc(3)) })
    render(<PdfCanvasViewer fileId="f1" pageCount={2} />)
    // happy-dom's <canvas> has no 2d context, so we assert the ready state (loading gone, no error)
    // rather than appended canvases, which need a real CanvasRenderingContext2D.
    await waitFor(() => expect(screen.queryByText(/Loading document/)).not.toBeInTheDocument())
    expect(screen.queryByText(/Could not render this document/)).not.toBeInTheDocument()
    expect(getDocument).toHaveBeenCalled()
  })

  it('shows an error note when the document fails to load', async () => {
    fetchStreamUrl.mockResolvedValue({ url: 'blob:pdf' })
    getDocument.mockReturnValue({ promise: Promise.reject(new Error('bad pdf')) })
    render(<PdfCanvasViewer fileId="f1" pageCount={1} />)
    await waitFor(() => expect(screen.getByText(/Could not render this document/)).toBeInTheDocument())
  })
})
