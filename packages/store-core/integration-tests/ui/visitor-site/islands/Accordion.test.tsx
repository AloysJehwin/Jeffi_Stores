import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Accordion, { AccordionItem } from '@/components/visitor/site/code/islands/Accordion'

const panel = (text: string) => screen.getByText(text).closest('div[id$="-panel"]') as HTMLElement

const faq = (props: Record<string, unknown> = {}) =>
  render(
    <Accordion {...props}>
      <AccordionItem title="Shipping" first>Ships in 2 days</AccordionItem>
      <AccordionItem title="Returns">30 day returns</AccordionItem>
      <AccordionItem title="Warranty">One year</AccordionItem>
    </Accordion>,
  )

describe('Accordion', () => {
  it('starts closed, with answers still in the HTML but hidden', () => {
    faq()
    expect(screen.getAllByRole('button').every(b => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(panel('Ships in 2 days')).toHaveAttribute('hidden')
  })

  it('opens the first item by default when asked', () => {
    faq({ defaultOpen: true })
    expect(screen.getByRole('button', { name: 'Shipping' })).toHaveAttribute('aria-expanded', 'true')
    expect(panel('Ships in 2 days')).not.toHaveAttribute('hidden')
    expect(screen.getByRole('button', { name: 'Returns' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens one item at a time, and closes it when clicked again', () => {
    faq()
    fireEvent.click(screen.getByRole('button', { name: 'Returns' }))
    expect(screen.getByRole('button', { name: 'Returns' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Warranty' }))
    expect(screen.getByRole('button', { name: 'Returns' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Warranty' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Warranty' }))
    expect(screen.getByRole('button', { name: 'Warranty' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps several items open with multiple', () => {
    faq({ multiple: true })
    fireEvent.click(screen.getByRole('button', { name: 'Shipping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Returns' }))
    expect(screen.getByRole('button', { name: 'Shipping' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Returns' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('works on its own for an item outside an accordion', () => {
    render(<AccordionItem title="Solo">Answer</AccordionItem>)
    const button = screen.getByRole('button', { name: 'Solo' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button.getAttribute('aria-controls')).toBe(panel('Answer').id)
  })
})
