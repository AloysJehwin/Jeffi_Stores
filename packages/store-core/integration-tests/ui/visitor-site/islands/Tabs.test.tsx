import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Tabs, { TabPanel } from '@/components/visitor/site/code/islands/Tabs'

const tabs = (props: Record<string, unknown> = {}) =>
  render(
    <Tabs {...props}>
      <TabPanel label="Details"><p>Product details</p></TabPanel>
      <TabPanel label="Reviews"><p>Customer reviews</p></TabPanel>
      <TabPanel label=""><p>Unlabelled</p></TabPanel>
    </Tabs>,
  )

describe('Tabs', () => {
  it('shows the first panel and keeps the others in the HTML, hidden', () => {
    tabs()
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Reviews' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Product details').closest('[role="tabpanel"]')).not.toHaveAttribute('hidden')
    expect(screen.getByText('Customer reviews').closest('[role="tabpanel"]')).toHaveAttribute('hidden')
  })

  it('switches panels on click and links tab and panel by aria ids', () => {
    tabs()
    const reviews = screen.getByRole('tab', { name: 'Reviews' })
    fireEvent.click(reviews)
    expect(reviews).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false')
    const panel = screen.getByText('Customer reviews').closest('[role="tabpanel"]')!
    expect(panel).not.toHaveAttribute('hidden')
    expect(panel.id).toBe(reviews.getAttribute('aria-controls'))
    expect(panel.getAttribute('aria-labelledby')).toBe(reviews.id)
    expect(screen.getByText('Product details').closest('[role="tabpanel"]')).toHaveAttribute('hidden')
  })

  it('names a tab without a label by its position', () => {
    tabs()
    expect(screen.getByRole('tab', { name: 'Tab 3' })).toBeInTheDocument()
  })

  it('applies the chosen look and centring, defaulting to underline', () => {
    const { unmount } = tabs({ variant: 'pills', align: 'center' })
    expect(screen.getByRole('tablist')).toHaveClass('justify-center')
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveClass('bg-foreground')
    unmount()
    tabs({ variant: 'nope' })
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveClass('border-accent-500')
  })

  it('renders nothing without panels', () => {
    const { container } = render(<Tabs />)
    expect(container).toBeEmptyDOMElement()
  })
})
