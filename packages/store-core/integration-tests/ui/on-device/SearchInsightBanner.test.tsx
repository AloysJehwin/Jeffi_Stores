import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const flags = { aiStorefrontEnabled: true }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
const readUserProfile = vi.fn<(...a: any[]) => any>()
vi.mock('@/lib/on-device/user-profile', () => ({ readUserProfile: () => readUserProfile() }))

import SearchInsightBanner from '@/components/on-device/SearchInsightBanner'

const profile = { purchaseCount: 3, topBrands: ['Sony', 'Bose'], topCategories: ['Headphones', 'Speakers'] }

describe('SearchInsightBanner', () => {
  beforeEach(() => {
    flags.aiStorefrontEnabled = true
    readUserProfile.mockReturnValue(profile)
  })

  it('names brands and categories from the buyer history that are in the results, case-insensitively', async () => {
    render(<SearchInsightBanner activeBrands={['sony', 'JBL']} activeCategories={['Headphones']} resultCount={12} />)
    expect(await screen.findByText('sony, Headphones')).toBeInTheDocument()
    expect(screen.getByText(/Matches your history/)).toBeInTheDocument()
    expect(screen.getByText('on-device')).toBeInTheDocument()
  })

  it('caps the list at three matches', async () => {
    readUserProfile.mockReturnValue({ ...profile, topBrands: ['A', 'B', 'C', 'D'], topCategories: [] })
    render(<SearchInsightBanner activeBrands={['a', 'b', 'c', 'd']} activeCategories={[]} resultCount={4} />)
    expect(await screen.findByText('a, b, c')).toBeInTheDocument()
  })

  it('renders nothing for a first-time buyer, no overlap, no results, or with AI off', async () => {
    readUserProfile.mockReturnValue({ ...profile, purchaseCount: 0 })
    const { container, rerender } = render(<SearchInsightBanner activeBrands={['Sony']} activeCategories={[]} resultCount={5} />)
    await waitFor(() => expect(readUserProfile).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()

    readUserProfile.mockReturnValue(profile)
    rerender(<SearchInsightBanner activeBrands={['Other']} activeCategories={['Cables']} resultCount={5} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<SearchInsightBanner activeBrands={['Sony']} activeCategories={[]} resultCount={0} />)
    await waitFor(() => expect(readUserProfile).toHaveBeenCalledTimes(3))
    expect(container).toBeEmptyDOMElement()
  })

  it('does not even read the profile when the storefront AI is off', () => {
    flags.aiStorefrontEnabled = false
    const { container } = render(<SearchInsightBanner activeBrands={['Sony']} activeCategories={[]} resultCount={5} />)
    expect(readUserProfile).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
