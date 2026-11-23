import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EmojiPicker from '@/components/admin/messaging-templates/EmojiPicker'

// Emoji picker popover. Groups come from a lazy JSON import (mocked). Shows a loading grid, then a
// group grid; search filters by name; picking calls onPick and records the choice in localStorage
// "recent". Esc fires onClose.

vi.mock('unicode-emoji-json/data-by-group.json', () => ({
  default: [
    {
      name: 'Smileys & Emotion',
      slug: 'smileys_emotion',
      emojis: [
        { emoji: '😀', name: 'grinning face' },
        { emoji: '😅', name: 'grinning face with sweat' },
      ],
    },
    {
      name: 'Food & Drink',
      slug: 'food_drink',
      emojis: [{ emoji: '🍔', name: 'hamburger' }],
    },
  ],
}))

describe('EmojiPicker (render + interaction)', () => {
  beforeEach(() => {
    try {
      localStorage.clear()
    } catch {
      /* happy-dom may lack it */
    }
  })

  it('renders the search box and loads the first group grid', async () => {
    render(<EmojiPicker onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByPlaceholderText('Search emoji')).toBeInTheDocument()
    // No recent -> defaults to the first group's tab; its emoji render after the lazy import resolves.
    await waitFor(() => expect(screen.getByTitle('grinning face')).toBeInTheDocument())
    expect(screen.getByTitle('grinning face with sweat')).toBeInTheDocument()
  })

  it('filters emoji by name on search', async () => {
    render(<EmojiPicker onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByTitle('grinning face')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search emoji'), { target: { value: 'hamburger' } })
    expect(screen.getByTitle('hamburger')).toBeInTheDocument()
    expect(screen.queryByTitle('grinning face')).not.toBeInTheDocument()
  })

  it('shows an empty-search message when nothing matches', async () => {
    render(<EmojiPicker onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByTitle('grinning face')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search emoji'), { target: { value: 'zzzz' } })
    expect(screen.getByText('No emoji found')).toBeInTheDocument()
  })

  it('calls onPick with the chosen emoji and persists it to recent', async () => {
    const onPick = vi.fn<(e: string) => void>()
    render(<EmojiPicker onPick={onPick} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByTitle('grinning face')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('grinning face'))
    expect(onPick).toHaveBeenCalledWith('😀')
    expect(JSON.parse(localStorage.getItem('jeffi:emoji-recent') || '[]')).toContain('😀')
  })

  it('fires onClose on Escape', async () => {
    const onClose = vi.fn<() => void>()
    render(<EmojiPicker onPick={() => {}} onClose={onClose} />)
    await waitFor(() => expect(screen.getByTitle('grinning face')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
