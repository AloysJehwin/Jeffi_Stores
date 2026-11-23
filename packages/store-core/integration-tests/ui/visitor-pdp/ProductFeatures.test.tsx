import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProductFeatures from '@/components/visitor/pdp/ProductFeatures'

// Pure render component: shows AI-enriched features / use cases / who-uses / application, each section
// gated on its own data; returns null when all four are empty.

describe('ProductFeatures (render + branches)', () => {
  it('renders nothing when the product has none of the AI fields', () => {
    const { container } = render(<ProductFeatures product={{ ai_features: [] }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the Key Features list from ai_features', () => {
    render(<ProductFeatures product={{ ai_features: ['Waterproof', 'Shockproof'] }} />)
    expect(screen.getByRole('heading', { name: 'Features & Use Cases' })).toBeInTheDocument()
    expect(screen.getByText('Key Features')).toBeInTheDocument()
    expect(screen.getByText('Waterproof')).toBeInTheDocument()
    expect(screen.getByText('Shockproof')).toBeInTheDocument()
    // No Use Cases section when ai_use_cases is empty.
    expect(screen.queryByText('Use Cases')).not.toBeInTheDocument()
  })

  it('renders Use Cases independently of features', () => {
    render(<ProductFeatures product={{ ai_use_cases: ['Camping', 'Travel'] }} />)
    expect(screen.getByText('Use Cases')).toBeInTheDocument()
    expect(screen.getByText('Camping')).toBeInTheDocument()
    expect(screen.queryByText('Key Features')).not.toBeInTheDocument()
  })

  it('renders Who Uses It and Application blocks', () => {
    render(<ProductFeatures product={{ ai_who_uses_it: 'Photographers', ai_application: 'Outdoor shoots' }} />)
    expect(screen.getByText('Who Uses It')).toBeInTheDocument()
    expect(screen.getByText('Photographers')).toBeInTheDocument()
    expect(screen.getByText('Application')).toBeInTheDocument()
    expect(screen.getByText('Outdoor shoots')).toBeInTheDocument()
  })

  it('renders all four sections together', () => {
    render(
      <ProductFeatures
        product={{
          ai_features: ['A'],
          ai_use_cases: ['B'],
          ai_who_uses_it: 'C',
          ai_application: 'D',
        }}
      />
    )
    expect(screen.getByText('Key Features')).toBeInTheDocument()
    expect(screen.getByText('Use Cases')).toBeInTheDocument()
    expect(screen.getByText('Who Uses It')).toBeInTheDocument()
    expect(screen.getByText('Application')).toBeInTheDocument()
  })
})
