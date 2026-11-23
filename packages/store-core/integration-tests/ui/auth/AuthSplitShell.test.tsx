import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuthSplitShell, {
  AuthSplitSkeleton,
  AUTH_THEMES,
  AUTH_POINTS,
} from '@/components/auth/AuthSplitShell'

// next/link renders a plain anchor in happy-dom.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const baseProps = {
  brandName: 'Acme',
  headline: 'Welcome back',
  points: ['First point', 'Second point'],
  theme: AUTH_THEMES.admin,
}

describe('AuthSplitShell (render)', () => {
  it('renders the headline, points (once per layout) and children', () => {
    render(
      <AuthSplitShell {...baseProps}>
        <div>Sign-in form here</div>
      </AuthSplitShell>
    )
    // Headline appears in both the desktop panel and the phone value card.
    expect(screen.getAllByText('Welcome back')).toHaveLength(2)
    // Each point is rendered in both the desktop aside and the phone card.
    expect(screen.getAllByText('First point')).toHaveLength(2)
    expect(screen.getAllByText('Second point')).toHaveLength(2)
    expect(screen.getByText('Sign-in form here')).toBeInTheDocument()
  })

  it('shows the brand initial fallback when no logo is given', () => {
    render(
      <AuthSplitShell {...baseProps} brandName="zephyr">
        <div>form</div>
      </AuthSplitShell>
    )
    // First char, uppercased. Rendered in both the desktop mark and phone mark.
    expect(screen.getAllByText('Z').length).toBeGreaterThanOrEqual(1)
  })

  it('renders a logo img instead of the initial when logoUrl is set', () => {
    render(
      <AuthSplitShell {...baseProps} logoUrl="https://cdn.example/logo.png">
        <div>form</div>
      </AuthSplitShell>
    )
    const imgs = screen.getAllByRole('presentation', { hidden: true }) as HTMLImageElement[]
    // At least one <img> carries the logo url.
    expect(imgs.some(i => i.getAttribute('src') === 'https://cdn.example/logo.png')).toBe(true)
  })

  it('points the brand links at homeHref', () => {
    render(
      <AuthSplitShell {...baseProps} homeHref="/dashboard">
        <div>form</div>
      </AuthSplitShell>
    )
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const l of links) expect(l).toHaveAttribute('href', '/dashboard')
  })

  it('renders optional sub, footnote and corner slot when provided', () => {
    render(
      <AuthSplitShell
        {...baseProps}
        sub="Enter your details"
        footnote="Trusted by many"
        corner={<button>Sign up</button>}
      >
        <div>form</div>
      </AuthSplitShell>
    )
    expect(screen.getByText('Enter your details')).toBeInTheDocument()
    expect(screen.getByText('Trusted by many')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument()
  })

  it('omits optional sub/footnote when not provided', () => {
    render(
      <AuthSplitShell {...baseProps}>
        <div>form</div>
      </AuthSplitShell>
    )
    expect(screen.queryByText('Enter your details')).not.toBeInTheDocument()
  })
})

describe('AuthSplitSkeleton (render)', () => {
  it('renders the placeholder split without crashing', () => {
    const { container } = render(<AuthSplitSkeleton theme={AUTH_THEMES.business} />)
    // Pure skeleton: several animated placeholder blocks, no interactive content.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})

describe('AUTH exports', () => {
  it('exposes themes and points used by the stores', () => {
    expect(AUTH_THEMES.business.panel).toContain('bg-gradient-to-br')
    expect(AUTH_POINTS.admin.length).toBeGreaterThan(0)
    expect(AUTH_POINTS.business.length).toBeGreaterThan(0)
  })
})
