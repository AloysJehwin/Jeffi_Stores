import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))
let aiAllowed = true
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => canWrite,
  useHasScope: () => true,
  useCanUseAi: () => aiAllowed,
  RequireAi: ({ children }: any) => (aiAllowed ? <>{children}</> : null),
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))
let lockState: any
vi.mock('@/hooks/useDraftLock', async orig => ({ ...(await orig<any>()), useDraftLock: () => lockState }))
let editSession: any
vi.mock('@/hooks/useEditSession', () => ({ useEditSession: () => editSession }))
vi.mock('@/components/admin/ImageUrlInput', () => ({
  default: ({ name, value, onChange, placeholder }: any) => (
    <input aria-label={name} name={name} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/admin/GoogleTaxonomyPicker', () => ({
  default: ({ name, categoryName }: any) => <input aria-label="google" name={name} data-cat={categoryName} defaultValue="" />,
}))
vi.mock('@/components/admin/CategoryFaqEditor', () => ({
  default: ({ categoryId, disabled }: any) => <div data-testid="faqs">{categoryId}|{String(!!disabled)}</div>,
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <>{children}</> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ name, label, options, defaultValue }: any) => (
    <label>
      {label}
      <select name={name} defaultValue={defaultValue}>
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  ),
}))

import CategoryForm from '@/components/admin/CategoryForm'

const categories = [
  { id: 'c1', name: 'Fasteners', parent_category_id: null, return_allowed: true, return_window_days: 15, replacement_allowed: false, replacement_window_days: 3 },
  { id: 'c2', name: 'Bolts', parent_category_id: 'c1', return_allowed: null },
  { id: 'c3', name: 'Pipes', parent_category_id: null },
]

const idle = { lock: null, loaded: true, readOnly: false, canDiscard: false, canTakeOver: false, viewers: [], isMine: true, closed: false, busy: false, claimable: false, unsaved: null }

describe('CategoryForm', () => {
  let location: any
  beforeEach(() => {
    aiAllowed = true
    canWrite = true
    lockState = { ...idle }
    editSession = { sessionId: null, cancel: vi.fn().mockResolvedValue(true) }
    location = { href: 'http://shop.test/', host: 'shop.test', hostname: 'shop.test', protocol: 'http:', origin: 'http://shop.test', pathname: '/', search: '', hash: '' }
    Object.defineProperty(window, 'location', { value: location, configurable: true, writable: true })
  })

  const mount = (props: Partial<React.ComponentProps<typeof CategoryForm>> = {}) =>
    render(<CategoryForm categories={categories} action={vi.fn()} {...props} />)

  it('renders an empty create form with the default icon, sections and Create label', () => {
    mount()
    expect(screen.getByLabelText(/Category Name/)).toHaveValue('')
    expect(screen.getByText('Package')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Category' })).toBeInTheDocument()
    for (const t of ['Category', 'Banner & reminders', 'Return & Replacement Policy', 'Display', 'SEO', 'Tax', 'Fulfilment'])
      expect(screen.getByText(t, { selector: 'h2' })).toBeInTheDocument()
    expect(screen.queryByTestId('faqs')).toBeNull()
  })

  it('prefills an existing category, shows FAQs and the Update label', () => {
    mount({ category: { id: 'c3', name: 'Pipes', display_order: 4, sku_prefix: 'PIP', icon_name: 'Wrench', description: 'Water pipes' } })
    expect(screen.getByLabelText(/Category Name/)).toHaveValue('Pipes')
    expect(screen.getByLabelText(/Display Order/)).toHaveValue(4)
    expect(screen.getByLabelText('SKU Prefix')).toHaveValue('PIP')
    expect(screen.getByLabelText('Description')).toHaveValue('Water pipes')
    expect(screen.getByText('Wrench')).toBeInTheDocument()
    expect(screen.getByTestId('faqs')).toHaveTextContent('c3|false')
    expect(screen.getByRole('button', { name: 'Update Category' })).toBeInTheDocument()
  })

  it('picks a default icon from the category name', () => {
    mount({ category: { id: 'x', name: 'Hand Tools' } })
    expect(screen.getByText('Toolbox', { selector: 'p' })).toBeInTheDocument()
  })

  it('lists parents as an indented tree and leaves the category and its subtree out', () => {
    mount({ category: { id: 'c1', name: 'Fasteners' } })
    const options = [...screen.getByLabelText('Parent Category').querySelectorAll('option')].map(o => o.textContent)
    expect(options).toEqual(['None (Main Category)', 'Pipes'])
  })

  it('shows sub-categories nested under their parent', () => {
    mount()
    const options = [...screen.getByLabelText('Parent Category').querySelectorAll('option')].map(o => o.textContent)
    expect(options[1]).toBe('Fasteners')
    expect(options[2]).toContain('└ Bolts')
  })

  it('browses, searches and picks an icon', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    fireEvent.change(screen.getByPlaceholderText('Search icons…'), { target: { value: 'zzzz' } })
    expect(screen.getByText('No icons match')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search icons…'), { target: { value: 'hammer' } })
    fireEvent.click(screen.getByTitle('Hammer'))
    expect(screen.getByText('Hammer', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search icons…')).toBeNull()
  })

  it('generates an icon with AI from the name', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ json: async () => ({ iconName: 'Truck' }) })
    vi.stubGlobal('fetch', f)
    mount()
    fireEvent.change(screen.getByLabelText(/Category Name/), { target: { value: 'Freight' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate with AI/ }))
    expect(await screen.findByText('Truck', { selector: 'p' })).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/admin/categories/suggest-icon')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: 'Freight' })
  })

  it('does not call AI without a name, and hides the button without the AI scope', () => {
    const f = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', f)
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: /Generate with AI/ }))
    expect(f).not.toHaveBeenCalled()
    first.unmount()
    aiAllowed = false
    mount()
    expect(screen.queryByRole('button', { name: /Generate with AI/ })).toBeNull()
  })

  it('passes the name to the Google taxonomy picker', () => {
    mount()
    fireEvent.change(screen.getByLabelText(/Category Name/), { target: { value: 'Pumps' } })
    expect(screen.getByLabelText('google')).toHaveAttribute('data-cat', 'Pumps')
  })

  it('submits the form data to the action', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    mount({ action, backUrl: '/admin/categories?page=2' })
    fireEvent.change(screen.getByLabelText(/Category Name/), { target: { value: 'Pumps' } })
    fireEvent.change(screen.getByLabelText('SKU Prefix'), { target: { value: 'PMP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    const fd: FormData = action.mock.calls[0][0]
    expect(fd.get('name')).toBe('Pumps')
    expect(fd.get('sku_prefix')).toBe('PMP')
    expect(fd.get('icon_name')).toBe('Package')
    expect(fd.get('is_active')).toBe('true')
    expect(fd.get('policy_override')).toBe('true')
    expect(fd.get('return_allowed')).toBe('true')
    expect(fd.get('return_window_days')).toBe('7')
    expect(fd.get('_back')).toBe('/admin/categories?page=2')
  })

  it('toasts and re-enables when saving fails', async () => {
    mount({ action: vi.fn().mockRejectedValue(new Error('db')) })
    fireEvent.change(screen.getByLabelText(/Category Name/), { target: { value: 'Pumps' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save category. Please try again.', 'error'))
    expect(screen.getByRole('button', { name: 'Create Category' })).toBeEnabled()
  })

  it('policy: windows show only while allowed, and are clamped to one day', () => {
    mount({ category: { id: 'c3', name: 'Pipes', return_allowed: true, return_window_days: 10, replacement_allowed: false } })
    expect(screen.getByLabelText('Return window (days)')).toHaveValue(10)
    expect(screen.queryByLabelText('Replacement window (days)')).toBeNull()
    fireEvent.change(screen.getByLabelText('Return window (days)'), { target: { value: '0' } })
    expect(screen.getByLabelText('Return window (days)')).toHaveValue(1)
    fireEvent.click(screen.getByRole('switch', { name: 'Replacement Allowed' }))
    expect(screen.getByLabelText('Replacement window (days)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Returns Allowed' }))
    expect(screen.queryByLabelText('Return window (days)')).toBeNull()
  })

  it('a sub-category without its own policy shows the inherited summary and can override and reset', () => {
    mount({ category: { id: 'c2', name: 'Bolts', parent_category_id: 'c1', return_allowed: null } })
    expect(screen.getByText(/Inherited from Fasteners — Returns 15d · No replacement/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Return window (days)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Override for this subcategory' }))
    expect(screen.getByLabelText('Return window (days)')).toHaveValue(15)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to inherited (use parent policy)' }))
    expect(screen.getByText(/Inherited from Fasteners/)).toBeInTheDocument()
  })

  it('draft mode offers Save as Draft and Update & Publish with intents', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    mount({ action, isDraft: true, category: { id: 'c3', name: 'Pipes' } })
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toHaveAttribute('value', 'draft')
    expect(screen.getByRole('button', { name: 'Update & Publish' })).toHaveAttribute('value', 'publish')
    fireEvent.submit(screen.getByRole('button', { name: 'Save as Draft' }).closest('form')!)
    await waitFor(() => expect(action).toHaveBeenCalled())
  })

  it('Discard draft calls discardAction with intent=discard', () => {
    const discardAction = vi.fn()
    mount({ isDraft: true, discardAction, category: { id: 'c3', name: 'Pipes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect((discardAction.mock.calls[0][0] as FormData).get('intent')).toBe('discard')
  })

  it('hides save buttons without categories:write', () => {
    canWrite = false
    mount()
    expect(screen.queryByRole('button', { name: 'Create Category' })).toBeNull()
  })

  it('Cancel links to the category list; with an edit session it cancels it and navigates to the category', async () => {
    const first = mount()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/admin/categories')
    first.unmount()
    editSession = { sessionId: 's1', cancel: vi.fn().mockResolvedValue(true) }
    mount({ category: { id: 'c3', name: 'Pipes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes?' }))
    await waitFor(() => expect(editSession.cancel).toHaveBeenCalled())
    expect(location.href).toBe('/admin/categories/c3')
  })

  it('a read-only lock disables the fields and FAQ editor and drops the save buttons', () => {
    lockState = { ...idle, readOnly: true, lock: { ownerName: 'Ravi' } }
    mount({ category: { id: 'c3', name: 'Pipes' } })
    expect(screen.getByLabelText(/Category Name/).closest('fieldset')).toBeDisabled()
    expect(screen.getByTestId('faqs')).toHaveTextContent('c3|true')
    expect(screen.queryByRole('button', { name: 'Update Category' })).toBeNull()
  })
})
