import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuthSplit from '@/components/visitor/site/AuthSplit'

// image-url is pure; mock to keep src/srcset deterministic.
vi.mock('@/lib/shared/image-url', () => ({
  responsiveImg: (src: string) => ({ src, srcSet: `${src} 640w` }),
}))

// A sign-in/up form beside an optional picture/brand panel. The form is a render-prop that
// receives `embedded`: true when wrapped in the split, false when rendered alone.
const form = (embedded: boolean) => <div data-testid="form">form embedded={String(embedded)}</div>

describe('AuthSplit (render + branches)', () => {
  it('renders the form alone (embedded=false) when no side image/heading/text', () => {
    const { container } = render(<AuthSplit props={{}} form={form} />)
    expect(screen.getByTestId('form')).toHaveTextContent('embedded=false')
    // No split <section> when the panel is absent.
    expect(container.querySelector('section')).toBeNull()
  })

  it('renders the split with the embedded form when a side heading is set', () => {
    render(<AuthSplit props={{ sideHeading: 'Welcome back' }} form={form} />)
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByTestId('form')).toHaveTextContent('embedded=true')
  })

  it('renders the side text alongside the heading', () => {
    render(<AuthSplit props={{ sideHeading: 'Hi', sideText: 'Sign in to continue' }} form={form} />)
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument()
  })

  it('renders the side image lazily by default', () => {
    const { container } = render(<AuthSplit props={{ sideImage: '/panel.jpg' }} form={form} />)
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toBeInTheDocument()
    expect(img.getAttribute('src')).toBe('/panel.jpg')
    expect(img.getAttribute('loading')).toBe('lazy')
  })

  it('loads the image eagerly with high priority when lcp is set', () => {
    const { container } = render(<AuthSplit props={{ sideImage: '/panel.jpg', lcp: true }} form={form} />)
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('fetchpriority')).toBe('high')
  })

  it('places the panel on the right (lg:order-2) when sidePosition is right', () => {
    const { container } = render(
      <AuthSplit props={{ sideHeading: 'Hi', sidePosition: 'right' }} form={form} />
    )
    expect(container.querySelector('.lg\\:order-2')).toBeInTheDocument()
  })

  it('treats a whitespace-only heading as absent (falls back to form-only)', () => {
    const { container } = render(<AuthSplit props={{ sideHeading: '   ' }} form={form} />)
    expect(container.querySelector('section')).toBeNull()
    expect(screen.getByTestId('form')).toHaveTextContent('embedded=false')
  })
})
