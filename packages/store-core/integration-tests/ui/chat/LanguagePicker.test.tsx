import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LanguagePicker from '@/components/chat/LanguagePicker'

// Wraps the app Select (portals its popup). Here we assert the trigger renders the current language
// and exposes the right accessible label; opening the portal popup is covered by Select's own tests.

describe('LanguagePicker', () => {
  it('renders the trigger with the current language label', () => {
    render(<LanguagePicker value="hi" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Chat language')).toBeInTheDocument()
    // native label for Hindi
    expect(screen.getByText('हिन्दी')).toBeInTheDocument()
  })

  it('falls back to English when value is null', () => {
    render(<LanguagePicker value={null} onChange={vi.fn()} />)
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('uses a custom title as the accessible label', () => {
    render(<LanguagePicker value="en" onChange={vi.fn()} title="Pick language" />)
    expect(screen.getByLabelText('Pick language')).toBeInTheDocument()
  })
})
