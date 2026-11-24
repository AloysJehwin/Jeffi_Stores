import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashCard } from '@/components/admin/dashboard/DashCard'

describe('DashCard', () => {
  it('renders the title, hint, action and body', () => {
    render(
      <DashCard title="Orders shipped" hint="last 26 weeks" action={<button>Act</button>}>
        <p>Body</p>
      </DashCard>
    )
    expect(screen.getByRole('heading', { name: 'Orders shipped' })).toBeInTheDocument()
    expect(screen.getByText('last 26 weeks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('is not a button without onClick', () => {
    render(<DashCard title="Plain">x</DashCard>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('becomes a button that activates on click, Enter and Space', () => {
    const onClick = vi.fn()
    render(
      <DashCard title="Open" ariaLabel="Open orders shipped" onClick={onClick}>
        x
      </DashCard>
    )
    const card = screen.getByRole('button', { name: 'Open orders shipped' })
    fireEvent.click(card)
    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.keyDown(card, { key: ' ' })
    fireEvent.keyDown(card, { key: 'a' })
    expect(onClick).toHaveBeenCalledTimes(3)
  })
})
