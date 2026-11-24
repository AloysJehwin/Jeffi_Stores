import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))

import { SectionHeading, ViewAllLink, SignInPrompt, SkeletonBlocks } from '@/components/visitor/home/business/parts'
import BusinessHomeProvider from '@/components/visitor/home/business/BusinessHomeProvider'

describe('business section parts', () => {
  it('SectionHeading shows eyebrow, title and an optional action', () => {
    render(<SectionHeading eyebrow="Quotes" title="Buying in bulk?" action={<button>Act</button>} />)
    expect(screen.getByText('Quotes')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Buying in bulk?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
  })

  it('ViewAllLink links to the given href with its label', () => {
    render(<ViewAllLink href="/business/products" label="View all" />)
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/business/products')
  })

  it('SignInPrompt asks a visitor to sign in, linking to the business sign-in page', () => {
    render(<SignInPrompt eyebrow="Buy again" title="Reorder" message="Sign in to reorder." />)
    expect(screen.getByRole('heading', { name: 'Reorder' })).toBeInTheDocument()
    expect(screen.getByText('Sign in to reorder.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign In/ })).toHaveAttribute('href', '/business/signin')
  })

  it('SignInPrompt uses the business-host path inside a provider on a business host', () => {
    render(
      <BusinessHomeProvider approved={false} query={null} host="business.shop.test">
        <SignInPrompt message="Sign in." />
      </BusinessHomeProvider>,
    )
    expect(screen.getByRole('link', { name: /Sign In/ })).toHaveAttribute('href', '/signin')
  })

  it('SkeletonBlocks renders the requested number of placeholders', () => {
    const { container } = render(<SkeletonBlocks count={3} className="h-10" />)
    expect(container.querySelectorAll('.animate-pulse.h-10')).toHaveLength(3)
  })
})
