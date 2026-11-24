import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/messaging-templates/EcomDialogShell', () => ({
  default: ({ open, title, description, footer, children }: any) =>
    open ? (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
        <div>{footer}</div>
      </div>
    ) : null,
}))
vi.mock('@/components/admin/messaging-templates/ScenarioFillDiff', () => ({ default: ({ proposed }: any) => <div data-testid="diff">{proposed.body}</div> }))

import ScenarioFillDialog, { ScenarioFillUndoBar } from '@/components/admin/messaging-templates/ScenarioFillDialog'

const ctx = { storeName: 'Halo' } as never
const current = {} as never
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

function setup(over: Record<string, unknown> = {}) {
  const props = { open: true, onClose: vi.fn(), channel: 'whatsapp' as const, templateMode: 'marketing' as const, tenantContext: ctx, current, applyFill: vi.fn().mockResolvedValue(undefined), ...over }
  render(<ScenarioFillDialog {...(props as any)} />)
  return props
}

describe('ScenarioFillDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('needs at least three characters before generating', () => {
    setup()
    expect(screen.getByText('Fill from scenario')).toBeInTheDocument()
    const gen = screen.getByRole('button', { name: /Generate preview/ })
    expect(gen).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Scenario/), { target: { value: 'ab' } })
    expect(gen).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Scenario/), { target: { value: 'Welcome new customers' } })
    expect(gen).toBeEnabled()
    expect(screen.getByText('21/500')).toBeInTheDocument()
  })

  it('generates a preview with the chosen options, then applies it and shows the undo bar', async () => {
    fetchMock.mockResolvedValue(ok({ body: 'Welcome aboard', priceInr: 1.5 }))
    const undo = vi.fn()
    const props = setup({ applyFill: vi.fn().mockResolvedValue({ undo }), isPlatformLibrary: true })
    fireEvent.change(screen.getByLabelText(/Scenario/), { target: { value: 'Welcome new customers' } })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: /Generate preview/ }))
    expect(await screen.findByTestId('diff')).toHaveTextContent('Welcome aboard')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ channel: 'whatsapp', scenarioText: 'Welcome new customers', templateMode: 'marketing', includeImage: true, isPlatformLibrary: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ai/template-scenario')
    fireEvent.click(screen.getByRole('button', { name: 'Apply · ₹1.50' }))
    await waitFor(() => expect(props.applyFill).toHaveBeenCalledWith({ body: 'Welcome aboard', priceInr: 1.5 }))
    expect(props.onClose).toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    expect(undo).toHaveBeenCalled()
  })

  it('shows the generation error and goes back from the preview', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({ error: 'Out of credits' }) })
    setup({ apiEndpoint: '/api/ecom/ai/template-scenario' })
    fireEvent.change(screen.getByLabelText(/Scenario/), { target: { value: 'Welcome new customers' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate preview/ }))
    expect(await screen.findByText('Out of credits')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ecom/ai/template-scenario')
    fetchMock.mockResolvedValueOnce(ok({ body: 'Draft' }))
    fireEvent.click(screen.getByRole('button', { name: /Generate preview/ }))
    await screen.findByTestId('diff')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Scenario/)).toBeInTheDocument()
  })

  it('hides the image options for SMS and closes from Cancel', () => {
    const props = setup({ channel: 'sms' })
    expect(screen.queryByText('Header image')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalled()
  })
})

describe('ScenarioFillUndoBar', () => {
  it('undoes and dismisses on click', async () => {
    const undo = vi.fn()
    const onDismiss = vi.fn()
    render(<ScenarioFillUndoBar handle={{ undo } as never} onDismiss={onDismiss} />)
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    expect(undo).toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalled()
  })

  it('auto-dismisses after the window', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<ScenarioFillUndoBar handle={{ undo: vi.fn() } as never} onDismiss={onDismiss} windowMs={1000} />)
    await act(async () => { vi.advanceTimersByTime(1100) })
    expect(onDismiss).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
