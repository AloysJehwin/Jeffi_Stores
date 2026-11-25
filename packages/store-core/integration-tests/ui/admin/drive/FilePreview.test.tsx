import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/ui/PdfPreview', () => ({ default: ({ url }: any) => <div data-testid="pdf" data-url={url} /> }))

import FilePreview from '@/components/admin/drive/FilePreview'

const file = (o: any = {}) => ({
  id: 'f1', folderId: null, name: 'photo.png', mime: 'image/png', kind: 'image', size: 2048, width: null, height: null, duration: null, blurhash: null,
  source: 'drive', createdAt: '2026-01-05T10:00:00Z', uploadedBy: 'Priya', url: '/files/1', thumbUrl: null, downloadUrl: '/files/1/dl', ...o,
})

describe('FilePreview', () => {
  it('shows an image with its name, details and the open/download links', () => {
    render(<FilePreview f={file() as any} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'photo.png' })).toBeInTheDocument()
    expect(screen.getByAltText('photo.png')).toHaveAttribute('src', '/files/1')
    expect(screen.getByText(/2\.0 KB · 5 Jan 2026 · Priya/)).toBeInTheDocument()
    const tab = screen.getByRole('link', { name: /Open in new tab/ })
    expect(tab).toHaveAttribute('href', '/files/1')
    expect(tab).toHaveAttribute('target', '_blank')
    const dl = screen.getByRole('link', { name: /Download/ })
    expect(dl).toHaveAttribute('href', '/files/1/dl')
    expect(dl).toHaveAttribute('download', 'photo.png')
  })

  it('marks a public gallery item and uses the document meta when present', () => {
    const { rerender } = render(<FilePreview f={file({ public: true, uploadedBy: null }) as any} onClose={() => {}} />)
    expect(screen.getByText(/Public \(gallery\)/)).toBeInTheDocument()
    rerender(<FilePreview f={file({ meta: 'Acme · ₹500', href: '/admin/invoices/9/view', source: 'document' }) as any} onClose={() => {}} />)
    expect(screen.getByText(/Acme · ₹500 · /)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open record/ })).toHaveAttribute('href', '/admin/invoices/9/view')
  })

  it('plays video and audio inline', () => {
    const { container, rerender } = render(<FilePreview f={file({ kind: 'video', name: 'clip.mp4' }) as any} onClose={() => {}} />)
    expect(container.ownerDocument.querySelector('video')).toHaveAttribute('src', '/files/1')
    rerender(<FilePreview f={file({ kind: 'audio', name: 'note.mp3' }) as any} onClose={() => {}} />)
    expect(container.ownerDocument.querySelector('audio')).toHaveAttribute('src', '/files/1')
  })

  it('renders pdfs through pdf.js with ?raw=1 for drive files only', () => {
    const { rerender } = render(<FilePreview f={file({ kind: 'pdf', name: 'a.pdf' }) as any} onClose={() => {}} />)
    expect(screen.getByTestId('pdf')).toHaveAttribute('data-url', '/files/1?raw=1')
    rerender(<FilePreview f={file({ kind: 'pdf', name: 'inv.pdf', source: 'document' }) as any} onClose={() => {}} />)
    expect(screen.getByTestId('pdf')).toHaveAttribute('data-url', '/files/1')
  })

  it('says there is no preview for other types', () => {
    render(<FilePreview f={file({ kind: 'other', name: 'bundle.zip' }) as any} onClose={() => {}} />)
    expect(screen.getByText(/No preview for this file type/)).toBeInTheDocument()
  })

  it('closes from the X', () => {
    const onClose = vi.fn()
    render(<FilePreview f={file() as any} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
