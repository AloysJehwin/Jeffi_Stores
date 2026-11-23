import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AttachmentView from '@/components/chat/AttachmentView'
import type { SupportAttachment } from '@/lib/support/types'

const att = (over: Partial<SupportAttachment> = {}): SupportAttachment => ({
  id: 'a1',
  kind: 'image',
  mime: 'image/png',
  name: 'photo.png',
  size: 2048,
  width: 100,
  height: 80,
  duration: null,
  url: '/api/files/a1',
  thumbUrl: null,
  ...over,
})

describe('AttachmentView', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<AttachmentView items={[]} mine={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders an image as a clickable thumbnail that opens a lightbox', () => {
    render(<AttachmentView items={[att()]} mine={false} />)
    const img = screen.getByAltText('photo.png')
    expect(img).toBeInTheDocument()
    // open lightbox via the wrapping button
    fireEvent.click(img)
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
    expect(screen.getByLabelText('Download')).toBeInTheDocument()
    // close it
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByLabelText('Close')).toBeNull()
  })

  it('renders a document as a file tile with name and size', () => {
    render(<AttachmentView items={[att({ kind: 'pdf', mime: 'application/pdf', name: 'invoice.pdf', size: 1024 * 1024 })]} mine={false} />)
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    // Kind + size line "PDF · 1.0 MB" — match the leaf span only (own text, no element children).
    expect(
      screen.getByText((_, el) => el?.textContent === 'PDF · 1.0 MB' && el?.children.length === 0)
    ).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/api/files/a1')
  })

  it('renders a video player for a video attachment', () => {
    const { container } = render(<AttachmentView items={[att({ kind: 'video', mime: 'video/mp4', name: 'clip.mp4' })]} mine={false} />)
    expect(container.querySelector('video')).toBeTruthy()
  })

  it('renders an audio player for an audio attachment', () => {
    const { container } = render(<AttachmentView items={[att({ kind: 'audio', mime: 'audio/mpeg', name: 'voice.mp3' })]} mine={false} />)
    expect(container.querySelector('audio')).toBeTruthy()
  })
})
