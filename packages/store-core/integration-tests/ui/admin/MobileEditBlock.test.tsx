import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const back = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ back }) }))

import MobileEditBlock from '@/components/admin/MobileEditBlock'

describe('MobileEditBlock', () => {
  it('shows the mobile notice and still renders the children for desktop', () => {
    render(<MobileEditBlock><p>Edit form</p></MobileEditBlock>)
    expect(screen.getByText('Editing is not available on mobile')).toBeInTheDocument()
    expect(screen.getByText('Edit form')).toBeInTheDocument()
    expect(screen.getByText('Edit form').parentElement?.className).toMatch(/hidden md:block/)
  })

  it('goes back from the Go back button', () => {
    render(<MobileEditBlock><p>x</p></MobileEditBlock>)
    fireEvent.click(screen.getByRole('button', { name: /Go back/ }))
    expect(back).toHaveBeenCalledTimes(1)
  })
})
