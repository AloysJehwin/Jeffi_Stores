import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import RewardsGameEditor from '@/components/admin/homepage/editors/RewardsGameEditor'
import { renderEditor, input, commit, choose, combo } from './editor-kit'

// RewardsGameEditor: wheel / scratch-card game config. Prizes are a tile list that serialises numbers and
// mints ids; a game id is minted once, and only for someone who can write.
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const prize = (over: Record<string, unknown> = {}) => ({ id: 'p1', label: '10% off', kind: 'percent', value: 10, weight: 1, ...over })
const playable = { gameKey: KEY, prizes: [prize(), prize({ id: 'p2', label: 'Try again', kind: 'none', value: 0, weight: 3 })] }

describe('RewardsGameEditor', () => {
  it('mints a game key the first time a writer opens an unkeyed section', () => {
    const { onChange, onSave } = renderEditor(RewardsGameEditor, 'rewards_game')
    expect(onSave).toHaveBeenCalledTimes(1)
    const body = onSave.mock.calls[0][1]
    expect(body.config.gameKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(onChange).toHaveBeenCalledWith('sec-1', { config: body.config })
  })

  it('does not mint a key without write access, and says when it will', () => {
    const { onSave } = renderEditor(RewardsGameEditor, 'rewards_game', {}, { canWrite: false })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/set the first time someone with write access opens/)).toBeInTheDocument()
  })

  it('keeps an existing key and shows it', () => {
    const { onSave } = renderEditor(RewardsGameEditor, 'rewards_game', { config: { gameKey: KEY } })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(new RegExp(`Game id ${KEY}`))).toBeInTheDocument()
  })

  it('warns that fewer than two prizes keeps the game hidden', () => {
    renderEditor(RewardsGameEditor, 'rewards_game', { config: { gameKey: KEY, prizes: [prize()] } })
    expect(screen.getByText(/Add at least two prizes/)).toBeInTheDocument()
  })

  it('shows odds and no warning for a playable game', () => {
    renderEditor(RewardsGameEditor, 'rewards_game', { config: playable })
    expect(screen.queryByText(/Add at least two prizes/)).toBeNull()
    expect(screen.getByText('Odds: 10% off 1 in 4 · Try again 1 in 1.3')).toBeInTheDocument()
  })

  it('flags prizes the game cannot use yet', () => {
    renderEditor(RewardsGameEditor, 'rewards_game', {
      config: { ...playable, prizes: [...playable.prizes, prize({ id: 'p3', label: 'Bad', value: 500 })] },
    })
    expect(screen.getByText(/One prize is not used yet/)).toBeInTheDocument()
  })

  it('saves game type and play limit alongside existing config', () => {
    const { onSave } = renderEditor(RewardsGameEditor, 'rewards_game', { config: { gameKey: KEY } })
    expect(combo('Game type')).toHaveTextContent('Spin the wheel')
    choose('Game type', 'Scratch card')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { gameKey: KEY, mode: 'scratch' } })
    choose('Play limit', 'Once a week')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { gameKey: KEY, playLimit: 'weekly' } })
  })

  it('adds a blank percent prize with a minted id', () => {
    const { onSave } = renderEditor(RewardsGameEditor, 'rewards_game', { config: { gameKey: KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    const prizes = onSave.mock.calls.at(-1)![1].config.prizes
    expect(prizes).toHaveLength(1)
    expect(prizes[0]).toMatchObject({ label: '', kind: 'percent' })
    expect(prizes[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('stores numeric prize fields as numbers and drops blanks', () => {
    const { onSave } = renderEditor(RewardsGameEditor, 'rewards_game', { config: playable })
    commit(input('Value', 0), '15')
    const first = onSave.mock.calls.at(-1)![1].config.prizes[0]
    expect(first).toEqual({ id: 'p1', label: '10% off', kind: 'percent', value: 15, weight: 1 })
    commit(input('Minimum order (₹)', 0), '499')
    expect(onSave.mock.calls.at(-1)![1].config.prizes[0].minPurchase).toBe(499)
  })

  it('changes a prize type', () => {
    const { onSave } = renderEditor(RewardsGameEditor, 'rewards_game', { config: playable })
    choose('Prize type', 'Rupees off', 0)
    expect(onSave.mock.calls.at(-1)![1].config.prizes[0].kind).toBe('fixed')
  })

  it('saves the button label to the row', () => {
    const { onSave } = renderEditor(RewardsGameEditor, 'rewards_game', { config: { gameKey: KEY } })
    commit(input('Button label'), 'Spin now')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { ctaLabel: 'Spin now' })
  })

  it('removes a prize and locks without write access', () => {
    const { onSave, unmount } = renderEditor(RewardsGameEditor, 'rewards_game', { config: playable })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    expect(onSave.mock.calls.at(-1)![1].config.prizes).toHaveLength(1)
    unmount()
    renderEditor(RewardsGameEditor, 'rewards_game', { config: playable }, { canWrite: false })
    expect(combo('Game type')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
  })
})
