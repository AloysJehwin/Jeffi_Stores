import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canAi = true
vi.mock('@/contexts/AdminScopesContext', () => ({ RequireAi: ({ children }: any) => (canAi ? <>{children}</> : null) }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ fieldLabel, children }: any) => <div data-ai={fieldLabel}>{children}</div> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, id }: any) => (
    <select id={id} aria-label={id ?? 'sel'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import { ExtraFieldsGroup, AiInsightsPanel, FaqEditor } from '@/components/admin/product-form/ProductExtraSections'

describe('ExtraFieldsGroup', () => {
  it('renders the group label, fields prefilled from the product and hints', () => {
    render(<form><ExtraFieldsGroup group="commercial" product={{ model_number: 'X-100', moq: 5, name: 'Drill' }} note="Optional details" /></form>)
    expect(screen.getByText('Commercial')).toBeInTheDocument()
    expect(screen.getByText('Optional details')).toBeInTheDocument()
    expect(screen.getByLabelText('Model number')).toHaveValue('X-100')
    expect(screen.getByLabelText('Minimum order quantity')).toHaveValue(5)
    expect(screen.getByLabelText('Replacement policy').tagName).toBe('TEXTAREA')
  })

  it('omits fields and wraps textareas with the AI helper', () => {
    const { container } = render(<ExtraFieldsGroup group="commercial" product={{}} omit={['series']} />)
    expect(screen.queryByLabelText('Series')).not.toBeInTheDocument()
    expect(container.querySelector('[data-ai="Replacement policy"]')).toBeInTheDocument()
  })

  it('renders nothing for a group without fields', () => {
    const { container } = render(<ExtraFieldsGroup group={'nope' as never} product={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the form value in a named field the form can read', () => {
    render(<form data-testid="f"><ExtraFieldsGroup group="overview" product={{ short_description: 'Tough drill' }} /></form>)
    const form = screen.getByTestId('f') as HTMLFormElement
    expect(new FormData(form).get('short_description')).toBe('Tough drill')
    fireEvent.change(screen.getByLabelText('Dimensions'), { target: { value: '10 x 10' } })
    expect(new FormData(form).get('dimensions')).toBe('10 x 10')
  })
})

describe('AiInsightsPanel', () => {
  it('shows the enrichment date and rows, with tags for lists', () => {
    render(<AiInsightsPanel product={{ ai_enriched_at: '2026-03-01T00:00:00Z', ai_product_type: 'Power drill', ai_keywords: ['drill', 'cordless'], ai_features: [] }} />)
    expect(screen.getByText('AI insights')).toBeInTheDocument()
    expect(screen.getByText(/Enriched/)).toBeInTheDocument()
    expect(screen.getByText('Power drill')).toBeInTheDocument()
    expect(screen.getByText('cordless')).toBeInTheDocument()
    expect(screen.queryByText('Features')).not.toBeInTheDocument()
  })

  it('shows the not-enriched state', () => {
    render(<AiInsightsPanel product={null} />)
    expect(screen.getByText('Not enriched yet')).toBeInTheDocument()
    expect(screen.getByText(/AI enrichment runs after publish/)).toBeInTheDocument()
  })
})

describe('FaqEditor', () => {
  beforeEach(() => {
    canAi = true
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>())
  })

  it('shows the empty state and only posts _faqs once edited', async () => {
    const onChange = vi.fn()
    const { container } = render(<FaqEditor initial={[]} onChange={onChange} aiContext="Drill" />)
    expect(screen.getByText(/No FAQs/)).toBeInTheDocument()
    expect(screen.getByText('0 questions')).toBeInTheDocument()
    expect(container.querySelector('input[name=_faqs]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add question/ }))
    expect(container.querySelector('input[name=_faqs]')).toBeInTheDocument()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(screen.getByText('1 question')).toBeInTheDocument()
  })

  it('edits, reorders, hides and removes questions', () => {
    const { container } = render(<FaqEditor initial={[{ id: '1', question: 'Q1', answer: 'A1' }, { id: '2', question: 'Q2', answer: 'A2' }]} onChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Move down')[0])
    const posted = () => JSON.parse((container.querySelector('input[name=_faqs]') as HTMLInputElement).value)
    expect(posted().map((r: any) => r.question)).toEqual(['Q2', 'Q1'])
    fireEvent.change(screen.getAllByPlaceholderText('Question')[0], { target: { value: 'Edited' } })
    expect(posted()[0].question).toBe('Edited')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(posted()[0].published).toBe(false)
    fireEvent.click(screen.getAllByTitle('Remove')[0])
    expect(posted()).toHaveLength(1)
  })

  it('generates FAQs with AI and appends them', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ faqs: [{ question: 'Is it cordless?', answer: 'Yes' }] }) } as never)
    render(<FaqEditor initial={[{ id: '1', question: 'Q1', answer: 'A1' }]} onChange={vi.fn()} aiContext="Drill" aiDetails={() => 'specs'} />)
    fireEvent.click(screen.getByRole('button', { name: /Suggest more with AI/ }))
    expect(await screen.findByDisplayValue('Is it cordless?')).toBeInTheDocument()
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body).toEqual({ context: 'Drill', details: 'specs', existing: ['Q1'] })
  })

  it('shows an AI error, and disables editing when disabled', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'No credits' }) } as never)
    const { unmount } = render(<FaqEditor initial={[]} onChange={vi.fn()} aiContext="Drill" />)
    fireEvent.click(screen.getByRole('button', { name: /Generate FAQs with AI/ }))
    expect(await screen.findByText('No credits')).toBeInTheDocument()
    unmount()
    render(<FaqEditor initial={[{ question: 'Q', answer: 'A' }]} onChange={vi.fn()} disabled />)
    expect(screen.getByPlaceholderText('Question')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add question/ })).toBeDisabled()
  })

  it('hides the AI button without the AI plan', () => {
    canAi = false
    render(<FaqEditor initial={[]} onChange={vi.fn()} aiContext="Drill" />)
    expect(screen.queryByRole('button', { name: /Generate FAQs with AI/ })).not.toBeInTheDocument()
  })
})
