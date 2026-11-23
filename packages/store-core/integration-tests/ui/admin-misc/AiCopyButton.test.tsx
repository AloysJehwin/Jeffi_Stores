import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// AiCopyButton gates on write + AI scope, then opens a brief input and POSTs to /api/admin/ai-fill-form,
// calling onFill with the returned fields. We drive the gates and the fetch via mocks.

let canWrite = true
let canUseAi = true
const showToast = vi.fn<(...a: any[]) => any>()

vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => canWrite,
  useCanUseAi: () => canUseAi,
}))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))

import AiCopyButton from '@/components/admin/ai/AiCopyButton'

const fields = [{ name: 'title', label: 'Title' }] as any

beforeEach(() => {
  canWrite = true
  canUseAi = true
})

describe('AiCopyButton (gating + open + fill)', () => {
  it('renders nothing without write scope', () => {
    canWrite = false
    const { container } = render(
      <AiCopyButton scope={'offers:write' as any} context="an offer" fields={fields} onFill={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when AI is off on the plan', () => {
    canUseAi = false
    const { container } = render(
      <AiCopyButton scope={'offers:write' as any} context="an offer" fields={fields} onFill={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the trigger with a custom label when allowed', () => {
    render(
      <AiCopyButton scope={'offers:write' as any} context="an offer" fields={fields} onFill={() => {}} label="Draft copy" />
    )
    expect(screen.getByRole('button', { name: /Draft copy/ })).toBeInTheDocument()
  })

  it('opens the brief input prefilled with defaultBrief on click', () => {
    render(
      <AiCopyButton
        scope={'offers:write' as any}
        context="an offer"
        defaultBrief="Diwali sale"
        fields={fields}
        onFill={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Write with AI/ }))
    expect((screen.getByLabelText('Brief for the AI') as HTMLInputElement).value).toBe('Diwali sale')
  })

  it('POSTs the brief and calls onFill with the trimmed returned fields', async () => {
    const onFill = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal(
      'fetch',
      vi.fn<(...a: any[]) => any>(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ fields: { title: '  Big Sale  ' } }) } as Response)
      )
    )
    render(<AiCopyButton scope={'offers:write' as any} context="an offer" fields={fields} onFill={onFill} />)
    fireEvent.click(screen.getByRole('button', { name: /Write with AI/ }))
    const input = screen.getByLabelText('Brief for the AI')
    fireEvent.change(input, { target: { value: 'power tools' } })
    fireEvent.click(screen.getByRole('button', { name: /^Write$/ }))
    await vi.waitFor(() => expect(onFill).toHaveBeenCalledWith({ title: 'Big Sale' }))
    expect(showToast).toHaveBeenCalledWith('Copy written', 'success')
  })
})
