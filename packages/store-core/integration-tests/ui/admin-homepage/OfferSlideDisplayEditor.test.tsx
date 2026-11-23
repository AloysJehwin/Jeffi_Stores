import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// OfferSlideDisplayEditor: the per-offer card styling panel. Text fields emit onChange patches as
// you type and PATCH-save on blur; the badge-colour swatches save a class. Heavy children (media
// picker, AI buttons) and contexts are mocked; AIEnrichButton is reduced to its wrapped child input.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const canWriteMock = vi.fn<(...a: any[]) => any>(() => true)
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWriteMock() }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Jeffi' } }) }))
vi.mock('@/components/admin/media/MediaField', () => ({
  default: ({ label }: any) => <div data-testid="media">{label}</div>,
}))
vi.mock('@/components/admin/ai/AiCopyButton', () => ({ default: () => <div data-testid="aicopy" /> }))
// Render only the wrapped child field; the sparkle overlay is not under test.
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <>{children}</> }))

import OfferSlideDisplayEditor, { type OfferSlide } from '@/components/admin/homepage/OfferSlideDisplayEditor'

const offer = (over: Partial<OfferSlide> = {}): OfferSlide => ({
  id: 'off_1',
  title: 'Diwali Sale',
  subtitle: 'Up to 50% off',
  badge_text: 'Diwali',
  badge_color: 'bg-red-500',
  cta_label: 'Shop now',
  image_url: null,
  blurhash: null,
  is_active: true,
  product_count: 3,
  ...over,
})

describe('OfferSlideDisplayEditor (render + branches)', () => {
  beforeEach(() => {
    canWriteMock.mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any)
  })

  it('renders both media slots and the current copy values', () => {
    render(<OfferSlideDisplayEditor offer={offer()} onChange={() => {}} />)
    expect(screen.getByText('Card media')).toBeInTheDocument()
    expect(screen.getByText('Wide media')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Up to 50% off')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Diwali')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Shop now')).toBeInTheDocument()
  })

  it('shows the centre-crop hint only when a wide image exists but no card image', () => {
    const { rerender } = render(<OfferSlideDisplayEditor offer={offer()} onChange={() => {}} />)
    expect(screen.queryByText(/centre crop of the wide one/)).not.toBeInTheDocument()
    rerender(<OfferSlideDisplayEditor offer={offer({ image_url: 'https://x/w.jpg', image_url_card: null })} onChange={() => {}} />)
    expect(screen.getByText(/centre crop of the wide one/)).toBeInTheDocument()
  })

  it('emits an onChange patch as the subtitle is typed', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<OfferSlideDisplayEditor offer={offer({ subtitle: '' })} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Short line shown under the title')
    fireEvent.change(input, { target: { value: 'New line' } })
    expect(onChange).toHaveBeenLastCalledWith({ subtitle: 'New line' })
  })

  it('PATCH-saves the current subtitle on blur', () => {
    render(<OfferSlideDisplayEditor offer={offer()} onChange={() => {}} />)
    const input = screen.getByDisplayValue('Up to 50% off')
    // Controlled by the offer prop; blur commits the current value through PATCH.
    fireEvent.blur(input)
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/product-offers/off_1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ subtitle: 'Up to 50% off' }) })
    )
  })

  it('saves null when the stored subtitle is empty on blur', () => {
    render(<OfferSlideDisplayEditor offer={offer({ subtitle: '' })} onChange={() => {}} />)
    const input = screen.getByPlaceholderText('Short line shown under the title')
    fireEvent.blur(input)
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/product-offers/off_1',
      expect.objectContaining({ body: JSON.stringify({ subtitle: null }) })
    )
  })

  it('choosing a badge colour calls onChange with the class and saves it', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<OfferSlideDisplayEditor offer={offer()} onChange={onChange} />)
    fireEvent.click(screen.getByTitle('Blue'))
    expect(onChange).toHaveBeenLastCalledWith({ badge_color: 'bg-blue-600' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/product-offers/off_1',
      expect.objectContaining({ body: JSON.stringify({ badgeColor: 'bg-blue-600' }) })
    )
  })

  it('disables the text inputs and colour swatches when the user cannot write', () => {
    canWriteMock.mockReturnValue(false)
    render(<OfferSlideDisplayEditor offer={offer()} onChange={() => {}} />)
    expect(screen.getByDisplayValue('Up to 50% off')).toBeDisabled()
    expect(screen.getByTitle('Blue')).toBeDisabled()
  })
})
