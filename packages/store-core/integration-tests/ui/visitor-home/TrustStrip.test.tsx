import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TrustStrip from '@/components/visitor/home/TrustStrip'

// TrustStrip: a row of trust tiles. {amount} is substituted with the threshold; honestTrustTiles drops
// the free-delivery tile without a threshold and the COD tile when COD is off.

describe('TrustStrip (render + honest filtering)', () => {
  it('substitutes {amount} with the formatted threshold', () => {
    render(
      <TrustStrip
        freeShippingThreshold={999}
        items={[{ icon: 'Truck', label: 'Free delivery over {amount}' }]}
      />
    )
    expect(screen.getByText('Free delivery over ₹999')).toBeInTheDocument()
  })

  it('drops the free-delivery tile when threshold is 0', () => {
    render(
      <TrustStrip
        freeShippingThreshold={0}
        items={[
          { icon: 'Truck', label: 'Free delivery over {amount}' },
          { icon: 'Shield', label: 'Secure checkout' },
        ]}
      />
    )
    expect(screen.queryByText(/Free delivery/)).toBeNull()
    expect(screen.getByText('Secure checkout')).toBeInTheDocument()
  })

  it('drops the COD tile when codEnabled is false', () => {
    render(
      <TrustStrip
        freeShippingThreshold={500}
        codEnabled={false}
        items={[
          { icon: 'Banknote', label: 'Cash on delivery' },
          { icon: 'Shield', label: 'Secure checkout' },
        ]}
      />
    )
    expect(screen.queryByText('Cash on delivery')).toBeNull()
    expect(screen.getByText('Secure checkout')).toBeInTheDocument()
  })

  it('renders nothing when every tile is filtered out', () => {
    const { container } = render(
      <TrustStrip
        freeShippingThreshold={0}
        codEnabled={false}
        items={[
          { icon: 'Truck', label: 'Free delivery over {amount}' },
          { icon: 'Banknote', label: 'Cash on delivery' },
        ]}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
