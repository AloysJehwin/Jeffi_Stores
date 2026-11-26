import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { secrets } from './fixtures'
import type { SecretRow } from '@/components/admin/providers/model'

// Secrets (flagship): names grouped by what reads them, with set / missing. The payload carries no values.

import SecretsStatus from '@/components/admin/providers/SecretsStatus'

describe('SecretsStatus', () => {
  it('groups the names with their secret store and presence', () => {
    render(<SecretsStatus secrets={secrets() as SecretRow[]} />)
    expect(screen.getByText('8 of 10 set')).toBeInTheDocument()
    const ai = within(screen.getByRole('list', { name: 'AI secrets' }))
    expect(ai.getByText('REPLICATE_API_TOKEN').closest('li')).toHaveTextContent('Missing')
    expect(ai.getByText('ANTHROPIC_API_KEY').closest('li')).toHaveTextContent('Set')
    expect(screen.getByText('jeffi/ai-gateway/production')).toBeInTheDocument()
    expect(screen.getAllByText('jeffi/production')).toHaveLength(3)
  })

  it('says when nothing was reported', () => {
    render(<SecretsStatus secrets={[]} />)
    expect(screen.getByText('No secret status was reported.')).toBeInTheDocument()
  })
})
