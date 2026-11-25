import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NoteAttachments from '@/components/admin/NoteAttachments'

const img = (o: Record<string, any> = {}) => ({ id: 'i1', kind: 'image', url: '/full.jpg', thumbnailUrl: '/thumb.jpg', originalName: 'receipt.jpg', ...o }) as any
const aud = (o: Record<string, any> = {}) => ({ id: 'a1', kind: 'audio', url: '/voice.mp3', durationSeconds: 12, ...o }) as any

describe('NoteAttachments', () => {
  it('renders nothing when there are no attachments', () => {
    const { container } = render(<NoteAttachments attachments={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows image thumbnails and audio with duration', () => {
    const { container } = render(<NoteAttachments attachments={[img(), aud()]} />)
    expect(screen.getByAltText('receipt.jpg')).toHaveAttribute('src', '/thumb.jpg')
    expect(container.querySelector('audio')).toHaveAttribute('src', '/voice.mp3')
    expect(screen.getByText('12s')).toBeInTheDocument()
  })

  it('falls back to the full url and a default alt, and sizes small thumbs', () => {
    render(<NoteAttachments size="sm" attachments={[img({ thumbnailUrl: null, originalName: null })]} />)
    const t = screen.getByAltText('Note photo')
    expect(t).toHaveAttribute('src', '/full.jpg')
    expect(t.closest('button')?.className).toMatch(/w-16 h-16/)
  })

  it('opens a lightbox with the original link and closes it', () => {
    render(<NoteAttachments attachments={[img()]} />)
    fireEvent.click(screen.getByRole('button', { name: /receipt\.jpg/ }))
    const dialog = screen.getByRole('dialog')
    expect(screen.getByRole('link', { name: 'Open original' })).toHaveAttribute('href', '/full.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(dialog).not.toBeInTheDocument()
  })

  it('closes the lightbox from the backdrop but not from the image', () => {
    render(<NoteAttachments attachments={[img()]} />)
    fireEvent.click(screen.getByRole('button', { name: /receipt\.jpg/ }))
    const full = screen.getAllByAltText('receipt.jpg').find(e => e.getAttribute('src') === '/full.jpg')!
    fireEvent.click(full)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
