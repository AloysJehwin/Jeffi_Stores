import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Segmented, ChoiceChips } from '@controller/app/(ecom)/ecom/_ui/choice'

const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }]

function Seg() {
  const [v, setV] = useState('a')
  return <Segmented ariaLabel="Tabs" options={opts} value={v} onChange={setV} />
}

function Chips() {
  const [v, setV] = useState<string[]>(['a'])
  return <ChoiceChips multiple ariaLabel="Chips" options={opts} value={v} onChange={setV} />
}

describe('Segmented', () => {
  it('moves aria-selected on click and arrow keys', () => {
    render(<Seg />)
    const tab = (n: string) => screen.getByRole('tab', { name: n })
    expect(tab('Alpha').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab('Beta'))
    expect(tab('Beta').getAttribute('aria-selected')).toBe('true')
    expect(tab('Alpha').getAttribute('aria-selected')).toBe('false')
    fireEvent.keyDown(tab('Beta'), { key: 'ArrowRight' })
    expect(tab('Gamma').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Gamma'))
    fireEvent.keyDown(tab('Gamma'), { key: 'ArrowRight' })
    expect(tab('Alpha').getAttribute('aria-selected')).toBe('true')
  })
})

describe('ChoiceChips', () => {
  it('toggles aria-pressed independently in multi mode', () => {
    render(<Chips />)
    const chip = (n: string) => screen.getByRole('button', { name: n })
    expect(chip('Alpha').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('Beta'))
    expect(chip('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Beta').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('Alpha'))
    expect(chip('Alpha').getAttribute('aria-pressed')).toBe('false')
  })
})
