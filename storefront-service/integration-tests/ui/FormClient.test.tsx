import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/image', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
let identity: any = { name: 'Halo', web: 'https://halo.test' }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity }) }))

import FormClient from '@storefront/app/(portal)/forms/[slug]/FormClient'

const fetchMock = vi.fn()
const form = (over: Record<string, any> = {}) => ({
  id: 'f1', title: 'Review us', description: 'Tell us how we did', template_type: 'google_review', google_review_url: 'https://g.test/review',
  slug: 'review-us', is_active: true, coupon_id: 'c1', custom_fields: [], ...over,
})
const png = () => new File(['x'], 'shot.png', { type: 'image/png' })
const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement
const upload = (input: HTMLInputElement, f: File) => fireEvent.change(input, { target: { files: [f] } })

describe('FormClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    identity = { name: 'Halo', web: 'https://halo.test' }
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows a closed notice for an inactive form', () => {
    render(<FormClient form={form({ is_active: false }) as any} />)
    expect(screen.getByRole('heading', { name: 'Form Closed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument()
  })

  it('google review template: shows title, description, the review link and a coupon CTA', () => {
    render(<FormClient form={form() as any} />)
    expect(screen.getByRole('heading', { name: 'Review us' })).toBeInTheDocument()
    expect(screen.getByText('Tell us how we did')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open Google Review Page' })
    expect(link).toHaveAttribute('href', 'https://g.test/review')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Get your discount coupon instantly')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit & Get Coupon' })).toBeDisabled()
  })

  it('without a coupon it says it will verify and the button has no coupon wording', () => {
    render(<FormClient form={form({ coupon_id: null }) as any} />)
    expect(screen.getByText("We'll verify your submission")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
  })

  it('the google template needs a screenshot: Submit enables only once email and file are set; the preview can be removed', async () => {
    const { container } = render(<FormClient form={form() as any} />)
    const submit = screen.getByRole('button', { name: /Submit/ })
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@x.test' } })
    expect(submit).toBeDisabled()
    upload(fileInput(container), png())
    expect(await screen.findByAltText('Preview')).toBeInTheDocument()
    expect(submit).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }))
    expect(screen.queryByAltText('Preview')).not.toBeInTheDocument()
    expect(submit).toBeDisabled()
  })

  it('rejects an invalid email without calling the server', () => {
    render(<FormClient form={form({ template_type: 'testimonial', coupon_id: null }) as any} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'nope' } })
    fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits the form data and shows the coupon reward', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ couponCode: 'THANKS10', couponDescription: 'On any order', validUntil: '2026-12-31T00:00:00Z', discountType: 'percentage', discountValue: 10 }),
    })
    const { container } = render(<FormClient form={form() as any} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@x.test' } })
    upload(fileInput(container), png())
    await screen.findByAltText('Preview')
    fireEvent.click(screen.getByRole('button', { name: 'Submit & Get Coupon' }))
    expect(await screen.findByText('Thank You!')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/forms/review-us/submit')
    expect(init.method).toBe('POST')
    expect(init.body.get('email')).toBe('a@x.test')
    expect((init.body.get('screenshot') as File).name).toBe('shot.png')
    expect(screen.getByText('THANKS10')).toBeInTheDocument()
    expect(screen.getByText('10% off on your next order')).toBeInTheDocument()
    expect(screen.getByText('On any order')).toBeInTheDocument()
    expect(screen.getByText(/Valid until/)).toHaveTextContent('31 December 2026')
    expect(screen.getByRole('link', { name: 'Shop Now at Halo' })).toHaveAttribute('href', 'https://halo.test')
  })

  it('a flat discount is shown in rupees and a submission without a coupon shows a thank-you note', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ couponCode: 'FLAT50', discountType: 'fixed', discountValue: 50 }) })
    const a = render(<FormClient form={form({ template_type: 'testimonial' }) as any} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@x.test' } })
    fireEvent.change(screen.getByPlaceholderText('Write your testimonial here…'), { target: { value: 'Great' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    expect(await screen.findByText('₹50 off on your next order')).toBeInTheDocument()
    a.unmount()
    identity = { name: 'Halo' }
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ couponCode: null }) })
    render(<FormClient form={form({ template_type: 'testimonial' }) as any} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    expect(await screen.findByText(/Your submission has been received/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Shop Now at Halo' })).toHaveAttribute('href', '/')
  })

  it('shows the server error and keeps the form', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Already submitted' }) })
    render(<FormClient form={form({ template_type: 'testimonial' }) as any} />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    expect(await screen.findByText('Already submitted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submit/ })).toBeEnabled()
  })

  it('product feedback: star rating is sent with the form', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ couponCode: null }) })
    render(<FormClient form={form({ template_type: 'product_feedback', coupon_id: null }) as any} />)
    expect(screen.getByText('Rate your experience')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '4 star' }))
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('Thank You!')
    expect(fetchMock.mock.calls[0][1].body.get('field___overall')).toBe('4')
  })

  it('testimonial shows its story box and an optional photo', () => {
    render(<FormClient form={form({ template_type: 'testimonial' }) as any} />)
    expect(screen.getByText('Share your story')).toBeInTheDocument()
    expect(screen.getByText('Tell us about your experience with Halo')).toBeInTheDocument()
    expect(screen.getByText('Photo (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submit/ })).toBeDisabled()
  })

  it('renders custom fields: text, textarea, rating and image, marking required ones', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ couponCode: null }) })
    const { container } = render(
      <FormClient
        form={form({
          template_type: 'testimonial',
          coupon_id: null,
          custom_fields: [
            { id: 'a', label: 'Your name', type: 'text', required: true },
            { id: 'b', label: 'Comments', type: 'textarea', required: false },
            { id: 'c', label: 'Service', type: 'rating', required: false },
            { id: 'd', label: 'Product photo', type: 'image', required: false },
          ],
        }) as any}
      />
    )
    expect(screen.getByText('Your name *')).toBeInTheDocument()
    expect(screen.getByText('Comments')).toBeInTheDocument()
    const stars = screen.getAllByRole('button', { name: '5 star' })
    fireEvent.click(stars[0])
    const fieldFile = container.querySelector('input[name="field_d"]') as HTMLInputElement
    upload(fieldFile, png())
    expect(await screen.findAllByAltText('Preview')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }))
    expect(screen.queryByAltText('Preview')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@x.test' } })
    fireEvent.change(container.querySelector('input[name="field_a"]')!, { target: { value: 'Asha' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    await screen.findByText('Thank You!')
    const body = fetchMock.mock.calls[0][1].body
    expect(body.get('field_a')).toBe('Asha')
    expect(body.get('field_c')).toBe('5')
  })

  it('dropping a non-image file is ignored', () => {
    const { container } = render(<FormClient form={form() as any} />)
    const zone = container.querySelector('.border-dashed') as HTMLElement
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
    expect(screen.queryByAltText('Preview')).not.toBeInTheDocument()
  })

  it('dropping an image sets the screenshot', async () => {
    const { container } = render(<FormClient form={form() as any} />)
    const zone = container.querySelector('.border-dashed') as HTMLElement
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } })
    expect(await screen.findByAltText('Preview')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByAltText('Preview')).toHaveAttribute('src', expect.stringContaining('data:')))
  })
})
