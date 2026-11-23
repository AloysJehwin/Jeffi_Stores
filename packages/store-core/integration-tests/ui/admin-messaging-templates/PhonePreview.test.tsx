import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PhonePreview from '@/components/admin/messaging-templates/PhonePreview'
import type { WaButton, WaCarouselCard } from '@/components/admin/messaging-templates/TemplateEditor'

// Live handset mock. Pure props — no network. Variables resolve to their sample value or a highlighted
// token; WhatsApp markdown becomes <b>/<i>/<s>; buttons/cards/media render per channel.

describe('PhonePreview (render + branches)', () => {
  it('renders the SMS frame with the brand initial and fills a known variable', () => {
    render(<PhonePreview channel="sms" body="Hi {{name}}, order ready" vars={{ name: 'Asha' }} brand="Mint" />)
    expect(screen.getByText('Mint')).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument() // avatar initial
    expect(screen.getByText(/Text Message · Today/)).toBeInTheDocument()
    expect(screen.getByText(/Hi Asha, order ready/)).toBeInTheDocument()
  })

  it('highlights an unfilled token rather than dropping it (SMS)', () => {
    const { container } = render(<PhonePreview channel="sms" body="Hello {{code}}" brand="S" />)
    // Unknown var becomes a <span> carrying the bare key.
    const span = container.querySelector('span[style*="background"]')
    expect(span?.textContent).toBe('code')
  })

  it('renders the WhatsApp frame chrome and applies *bold* markdown', () => {
    const { container } = render(<PhonePreview channel="whatsapp" body="Order *shipped* today" brand="Glass" />)
    expect(screen.getByText('Glass')).toBeInTheDocument()
    expect(screen.getByText('Business account')).toBeInTheDocument()
    expect(screen.getByText('TODAY')).toBeInTheDocument()
    expect(container.querySelector('b')?.textContent).toBe('shipped')
  })

  it('renders action buttons and quick replies split by type', () => {
    const buttons: WaButton[] = [
      { type: 'url', label: 'Track order', value: 'https://x' },
      { type: 'quick_reply', label: 'Stop' },
    ]
    render(<PhonePreview channel="whatsapp" body="Hi" buttons={buttons} brand="S" />)
    expect(screen.getByText('Track order')).toBeInTheDocument() // action row
    expect(screen.getByText('Stop')).toBeInTheDocument() // quick reply
  })

  it('renders a header image for an image media url', () => {
    const { container } = render(
      <PhonePreview channel="whatsapp" body="Hi" headerMedia="https://cdn/x/photo.jpg" brand="S" />
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('https://cdn/x/photo.jpg')
  })

  it('shows a filename placeholder for a non-image media url', () => {
    render(<PhonePreview channel="whatsapp" body="Hi" headerMedia="https://cdn/x/invoice.pdf" brand="S" />)
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
  })

  it('renders carousel cards with titles and bodies', () => {
    const cards: WaCarouselCard[] = [
      { title: 'Card one', body: 'First *item*', media_url: 'https://cdn/a.png' },
      { title: 'Card two', body: 'Second' },
    ]
    render(<PhonePreview channel="whatsapp" body="Browse" cards={cards} brand="S" />)
    expect(screen.getByText('Card one')).toBeInTheDocument()
    expect(screen.getByText('Card two')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})
