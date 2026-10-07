import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/library', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/visitor/Header', () => ({ default: () => <header data-testid="store-header" /> }))
vi.mock('@/components/visitor/PageTracker', () => ({ default: () => null }))
vi.mock('@/components/visitor/CompareBar', () => ({ default: () => <div data-testid="compare-bar" /> }))
vi.mock('@/components/PolicyConsentGate', () => ({ default: () => <div data-testid="consent" /> }))

import ConditionalLayout from '@/components/ConditionalLayout'

describe('ConditionalLayout on the vault host', () => {
  it('renders vault pages bare: no store header, compare bar, or consent gate', () => {
    render(
      <ConditionalLayout isVaultSubdomain>
        <p>vault library</p>
      </ConditionalLayout>
    )
    expect(screen.getByText('vault library')).toBeTruthy()
    expect(screen.queryByTestId('store-header')).toBeNull()
    expect(screen.queryByTestId('compare-bar')).toBeNull()
    expect(screen.queryByTestId('consent')).toBeNull()
  })
})
