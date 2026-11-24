import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))
vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => true,
  useHasScope: () => true,
  useCanUseAi: () => false,
  RequireAi: () => null,
  RequireWrite: ({ children }: any) => <>{children}</>,
}))

let lockState: any
vi.mock('@/hooks/useDraftLock', async orig => ({
  ...(await orig<any>()),
  useDraftLock: () => lockState,
}))
let editSession: any
vi.mock('@/hooks/useEditSession', () => ({ useEditSession: () => editSession }))
vi.mock('@/components/admin/ImageUrlInput', () => ({
  default: ({ name, value, onChange }: any) => (
    <input aria-label="Logo" name={name} value={value} onChange={e => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/admin/AIFillForm', () => ({
  default: ({ onFill }: any) => (
    <button
      type="button"
      onClick={() =>
        onFill({ name: 'AI Brand', slug: 'AI Brand!', description: 'AI desc', website: 'https://ai.test', is_active: false, return_allowed: false, replacement_window_days: 14 })
      }
    >
      ai-fill
    </button>
  ),
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <>{children}</> }))

import BrandForm from '@/components/admin/BrandForm'
import { BRAND_SECTIONS } from '@/lib/catalog/brand-fields'

const brand = {
  id: 'b1',
  name: 'Acme',
  slug: 'acme',
  website: 'https://acme.test',
  description: 'Tools',
  logo_url: 'https://cdn.test/l.png',
  is_active: true,
  return_allowed: true,
  return_window_days: 10,
  replacement_allowed: false,
  replacement_window_days: 5,
}

const idle = { lock: null, loaded: true, readOnly: false, canDiscard: false, canTakeOver: false, viewers: [], isMine: true, closed: false, busy: false, claimable: false, unsaved: null }

describe('BrandForm', () => {
  beforeEach(() => {
    lockState = { ...idle }
    editSession = { sessionId: null, cancel: vi.fn().mockResolvedValue(true) }
  })

  it('renders an empty create form with the profile sections', () => {
    render(<BrandForm action={vi.fn()} />)
    expect(screen.getByLabelText(/Brand Name/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Create Brand' })).toBeInTheDocument()
    for (const s of BRAND_SECTIONS) expect(screen.getByText(s)).toBeInTheDocument()
    expect(screen.getByText('Return & Replacement Policy')).toBeInTheDocument()
  })

  it('prefills an existing brand and labels the button Update Brand', () => {
    render(<BrandForm action={vi.fn()} brand={brand} />)
    expect(screen.getByLabelText(/Brand Name/)).toHaveValue('Acme')
    expect(screen.getByLabelText(/Slug/)).toHaveValue('acme')
    expect(screen.getByLabelText('Website')).toHaveValue('https://acme.test')
    expect(screen.getByLabelText('Description')).toHaveValue('Tools')
    expect(screen.getByLabelText('Logo')).toHaveValue('https://cdn.test/l.png')
    expect(screen.getByLabelText('Return window (days)')).toHaveValue(10)
    expect(screen.getByRole('button', { name: 'Update Brand' })).toBeInTheDocument()
  })

  it('submitLabel overrides the button text', () => {
    render(<BrandForm action={vi.fn()} submitLabel="Save it" />)
    expect(screen.getByRole('button', { name: 'Save it' })).toBeInTheDocument()
  })

  it('auto-fills the slug from the name on a new brand only', () => {
    const first = render(<BrandForm action={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Brand Name/), { target: { value: 'Black & Decker' } })
    expect(screen.getByLabelText(/Slug/)).toHaveValue('black-decker')
    first.unmount()
    render(<BrandForm action={vi.fn()} brand={brand} />)
    fireEvent.change(screen.getByLabelText(/Brand Name/), { target: { value: 'Changed' } })
    expect(screen.getByLabelText(/Slug/)).toHaveValue('acme')
  })

  it('submits the form data to the action', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    render(<BrandForm action={action} brand={brand} backUrl="/admin/brands?page=2" />)
    fireEvent.click(screen.getByRole('button', { name: 'Update Brand' }))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    const fd: FormData = action.mock.calls[0][0]
    expect(fd.get('name')).toBe('Acme')
    expect(fd.get('slug')).toBe('acme')
    expect(fd.get('logo_url')).toBe('https://cdn.test/l.png')
    expect(fd.get('is_active')).toBe('true')
    expect(fd.get('return_allowed')).toBe('true')
    expect(fd.get('return_window_days')).toBe('10')
    expect(fd.get('replacement_allowed')).toBe('false')
    expect(fd.get('_back')).toBe('/admin/brands?page=2')
  })

  it('toasts and re-enables the button when saving fails', async () => {
    const action = vi.fn().mockRejectedValue(new Error('db down'))
    render(<BrandForm action={action} brand={brand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Update Brand' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save brand. Please try again.', 'error'))
    expect(screen.getByRole('button', { name: 'Update Brand' })).toBeEnabled()
  })

  it('shows Saving… while the action is pending', async () => {
    render(<BrandForm action={() => new Promise(() => {})} brand={brand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Update Brand' }))
    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
  })

  it('hides the policy section on plans without returns', () => {
    render(<BrandForm action={vi.fn()} hasReturns={false} />)
    expect(screen.queryByText('Return & Replacement Policy')).toBeNull()
  })

  it('shows the window field only while returns are allowed', () => {
    render(<BrandForm action={vi.fn()} brand={brand} />)
    expect(screen.queryByLabelText('Replacement window (days)')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Replacement Allowed' }))
    expect(screen.getByLabelText('Replacement window (days)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Returns Allowed' }))
    expect(screen.queryByLabelText('Return window (days)')).toBeNull()
  })

  it('clamps the window to at least one day', () => {
    render(<BrandForm action={vi.fn()} brand={brand} />)
    fireEvent.change(screen.getByLabelText('Return window (days)'), { target: { value: '0' } })
    expect(screen.getByLabelText('Return window (days)')).toHaveValue(1)
  })

  it('applies AI-filled values', () => {
    render(<BrandForm action={vi.fn()} brand={brand} />)
    fireEvent.click(screen.getByText('ai-fill'))
    expect(screen.getByLabelText(/Brand Name/)).toHaveValue('AI Brand')
    expect(screen.getByLabelText(/Slug/)).toHaveValue('ai-brand-')
    expect(screen.getByLabelText('Website')).toHaveValue('https://ai.test')
    expect(screen.getByLabelText('Description')).toHaveValue('AI desc')
    expect(screen.getByRole('switch', { name: 'Active' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Returns Allowed' })).toHaveAttribute('aria-checked', 'false')
  })

  it('draft mode offers Save as Draft and Update & Publish with intents, and a draft badge', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    render(<BrandForm action={action} brand={brand} isDraft />)
    expect(screen.getByText('Draft pending')).toBeInTheDocument()
    const draft = screen.getByRole('button', { name: 'Save as Draft' })
    expect(draft).toHaveAttribute('value', 'draft')
    expect(screen.getByRole('button', { name: 'Update & Publish' })).toHaveAttribute('value', 'publish')
    fireEvent.submit(draft.closest('form')!)
    await waitFor(() => expect(action).toHaveBeenCalled())
  })

  it('a new draft labels the publish button Save & Publish', () => {
    render(<BrandForm action={vi.fn()} isDraft />)
    expect(screen.getByRole('button', { name: 'Save & Publish' })).toBeInTheDocument()
  })

  it('Discard draft calls discardAction with intent=discard', () => {
    const discardAction = vi.fn()
    render(<BrandForm action={vi.fn()} brand={brand} isDraft discardAction={discardAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect((discardAction.mock.calls[0][0] as FormData).get('intent')).toBe('discard')
  })

  it('Cancel links back to the brand list, honouring a safe backUrl only', () => {
    const first = render(<BrandForm action={vi.fn()} backUrl="/admin/brands?page=2" />)
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/admin/brands?page=2')
    first.unmount()
    render(<BrandForm action={vi.fn()} backUrl="https://evil.test" />)
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/admin/brands')
  })

  it('with an edit session, Cancel asks to confirm then closes the session and leaves', async () => {
    editSession = { sessionId: 's1', cancel: vi.fn().mockResolvedValue(true) }
    render(<BrandForm action={vi.fn()} brand={brand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes?' }))
    await waitFor(() => expect(editSession.cancel).toHaveBeenCalled())
    expect(push).toHaveBeenCalledWith('/admin/brands')
  })

  it('a read-only draft lock disables the fields and replaces the save buttons', () => {
    lockState = { ...idle, readOnly: true, lock: { ownerName: 'Ravi' } }
    render(<BrandForm action={vi.fn()} brand={brand} isDraft />)
    expect(screen.getByLabelText(/Brand Name/).closest('fieldset')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument()
  })
})
