import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Tooltip from '@/components/ui/Tooltip'

describe('Tooltip (render + hover)', () => {
  it('renders the trigger child and hides the tooltip initially', () => {
    render(
      <Tooltip content="Help text">
        <button>Trigger</button>
      </Tooltip>
    )
    expect(screen.getByText('Trigger')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows the tooltip content after hover (delay 0)', async () => {
    render(
      <Tooltip content="Help text" delay={0}>
        <button>Trigger</button>
      </Tooltip>
    )
    fireEvent.mouseEnter(screen.getByText('Trigger').parentElement!)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Help text')
  })

  it('hides the tooltip on mouse leave', async () => {
    render(
      <Tooltip content="Help text" delay={0}>
        <button>Trigger</button>
      </Tooltip>
    )
    const wrap = screen.getByText('Trigger').parentElement!
    fireEvent.mouseEnter(wrap)
    await screen.findByRole('tooltip')
    fireEvent.mouseLeave(wrap)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
