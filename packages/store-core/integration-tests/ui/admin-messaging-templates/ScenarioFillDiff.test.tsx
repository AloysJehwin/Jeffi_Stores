import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScenarioFillDiff from '@/components/admin/messaging-templates/ScenarioFillDiff'
import type { EditorFieldSnapshot } from '@/lib/ai/scenario-fill-apply'
import type { TemplateScenarioFill } from '@/lib/ai/template-scenario.schema'

// Side-by-side current vs proposed per field. Changed rows open by default (and show Current/Proposed
// cells); unchanged rows collapse. Field set varies by channel (email adds subject/preview; sms drops
// buttons/image).

const snap = (over: Partial<EditorFieldSnapshot> = {}): EditorFieldSnapshot => ({
  name: 'Old name',
  body: 'Old body',
  placeholders: ['name'],
  buttons: [],
  ...over,
})

const fill = (over: Partial<TemplateScenarioFill> = {}): TemplateScenarioFill => ({
  name: 'New name',
  body: 'New body',
  placeholders: ['name'],
  buttons: [],
  ...over,
})

describe('ScenarioFillDiff (render + branches)', () => {
  it('renders a row per base field and marks changed vs unchanged', () => {
    render(<ScenarioFillDiff channel="whatsapp" current={snap()} proposed={fill()} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
    expect(screen.getByText('Placeholders')).toBeInTheDocument()
    // Name/Body differ -> "changed"; placeholders identical -> "unchanged".
    expect(screen.getAllByText('changed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('unchanged').length).toBeGreaterThanOrEqual(1)
  })

  it('opens changed rows by default and shows both cells', () => {
    render(<ScenarioFillDiff channel="whatsapp" current={snap()} proposed={fill()} />)
    // The changed Name row is expanded: both values visible.
    expect(screen.getByText('Old name')).toBeInTheDocument()
    expect(screen.getByText('New name')).toBeInTheDocument()
    expect(screen.getAllByText('Current').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Proposed').length).toBeGreaterThanOrEqual(1)
  })

  it('collapses an unchanged row until toggled', () => {
    render(
      <ScenarioFillDiff
        channel="whatsapp"
        current={snap({ name: 'Same', body: 'Same body' })}
        proposed={fill({ name: 'Same', body: 'Same body' })}
      />
    )
    // Every row unchanged -> no cells shown initially.
    expect(screen.queryByText('Proposed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(screen.getByText('Proposed')).toBeInTheDocument()
  })

  it('adds subject and preview rows for the email channel', () => {
    render(
      <ScenarioFillDiff
        channel="email"
        current={snap({ subject: 'S1', preview: 'P1' })}
        proposed={fill({ subject: 'S2', preview: 'P2' })}
      />
    )
    expect(screen.getByText('Subject')).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
  })

  it('omits buttons and image rows for the sms channel', () => {
    render(
      <ScenarioFillDiff
        channel="sms"
        current={snap({ image_url: 'https://a' })}
        proposed={fill({ image_url: 'https://b' })}
      />
    )
    expect(screen.queryByText('Buttons')).not.toBeInTheDocument()
    expect(screen.queryByText('Header image')).not.toBeInTheDocument()
  })

  it('renders a Buttons row for whatsapp and a Header image row when an image exists', () => {
    render(
      <ScenarioFillDiff
        channel="whatsapp"
        current={snap({ buttons: [{ type: 'url', label: 'Buy', value: 'https://x' }] })}
        proposed={fill({ buttons: [], image_url: 'https://new' })}
      />
    )
    expect(screen.getByText('Buttons')).toBeInTheDocument()
    expect(screen.getByText('Header image')).toBeInTheDocument()
  })
})
