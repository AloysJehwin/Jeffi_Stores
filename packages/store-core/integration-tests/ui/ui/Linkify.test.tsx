import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderTextWithLinks } from '@/components/ui/Linkify'

// renderTextWithLinks returns ReactNode; render it inside a host element and assert the output.
describe('Linkify renderTextWithLinks', () => {
  it('returns plain text unchanged when there are no URLs', () => {
    render(<div>{renderTextWithLinks('just some words')}</div>)
    expect(screen.getByText('just some words')).toBeInTheDocument()
  })

  it('wraps a URL in a safe external anchor', () => {
    render(<div>{renderTextWithLinks('see https://example.com now')}</div>)
    const a = screen.getByRole('link')
    expect(a).toHaveAttribute('href', 'https://example.com')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('strips trailing punctuation out of the link href', () => {
    render(<div>{renderTextWithLinks('go to https://example.com.')}</div>)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com')
  })

  it('renders multiple links in one string', () => {
    render(<div>{renderTextWithLinks('http://a.com and http://b.com')}</div>)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'http://a.com')
    expect(links[1]).toHaveAttribute('href', 'http://b.com')
  })

  it('returns empty input as-is (no link)', () => {
    const { container } = render(<div>{renderTextWithLinks('')}</div>)
    expect(container.querySelector('a')).toBeNull()
  })
})
