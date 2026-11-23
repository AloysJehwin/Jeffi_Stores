import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// PresetChipRow fetches merged preset prompts and renders a chip per preset. Clicking a chip fills the
// parent via onPick(prompt) and marks it active; a Reset chip then clears it. Empty list => renders nothing.

vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))

import PresetChipRow from '@/components/admin/ai/PresetChipRow'

function mockPresets(presets: any[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn<(...a: any[]) => any>(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ presets }) } as Response))
  )
}

beforeEach(() => {
  mockPresets([])
})

describe('PresetChipRow (fetch-driven render + pick)', () => {
  it('renders nothing when no presets come back', async () => {
    const { container } = render(<PresetChipRow kind="image" onPick={() => {}} />)
    await vi.waitFor(() => expect((fetch as any)).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('renders a chip per preset with a Title Case label from the scenario', async () => {
    mockPresets([
      { kind: 'image', scenario: 'product_hero', prompt: 'A clean hero shot' },
      { kind: 'image', scenario: 'lifestyle_shot', prompt: 'In use at home' },
    ])
    render(<PresetChipRow kind="image" onPick={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Product Hero' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lifestyle Shot' })).toBeInTheDocument()
  })

  it('calls onPick with the prompt and shows a Reset chip after a pick', async () => {
    const onPick = vi.fn<(...a: any[]) => any>()
    mockPresets([{ kind: 'image', scenario: 'product_hero', prompt: 'A clean hero shot' }])
    render(<PresetChipRow kind="image" onPick={onPick} />)
    const chip = await screen.findByRole('button', { name: 'Product Hero' })
    fireEvent.click(chip)
    expect(onPick).toHaveBeenLastCalledWith('A clean hero shot')
    const reset = screen.getByRole('button', { name: 'Reset' })
    fireEvent.click(reset)
    expect(onPick).toHaveBeenLastCalledWith('')
  })
})
