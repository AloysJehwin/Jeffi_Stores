import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState, createElement } from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/CompareContext', () => ({
  useCompare: () => ({ compareList: [{ id: 'a', name: 'Alpha', image: null }], removeFromCompare: vi.fn(), clearCompare: vi.fn() }),
}))
// next/dynamic resolves the lazy import; emulate it so the module loads under test.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) =>
    function Lazy(props: any) {
      const [C, setC] = useState<any>(null)
      useEffect(() => {
        loader().then((m: any) => setC(() => m.default))
      }, [])
      return C ? createElement(C, props) : null
    },
}))

import CompareStripLazy from '@/components/visitor/CompareStripLazy'

describe('CompareStripLazy', () => {
  it('lazy-loads the strip and then renders the compare list', async () => {
    render(<CompareStripLazy />)
    await waitFor(() => expect(screen.getByText('1 / 4')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Remove Alpha' })).toBeInTheDocument()
  })
})
