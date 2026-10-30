import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, screen, act } from '@testing-library/react'
import EmailComposer from '@/components/admin/email-composer/EmailComposer'
import RichTextEditor from '@/components/admin/RichTextEditor'
import { resetTemplateVariablesCache } from '@/components/admin/email-composer/variables'

const apiVars = [
  { key: 'store_name', label: 'Store name', description: 'Store', group: 'store', sample: 'Acme', builtIn: true },
  { key: 'loyalty_tier', label: 'Tier', description: 'Custom tier', group: 'custom', sample: 'Gold', builtIn: false },
]

beforeEach(() => {
  resetTemplateVariablesCache()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ variables: apiVars }), { status: 200 }))
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function mount(value = '<p>Hello</p>', props: Partial<Parameters<typeof EmailComposer>[0]> = {}) {
  const onChange = vi.fn()
  const view = render(<EmailComposer value={value} onChange={onChange} {...props} />)
  await waitFor(() => expect(view.container.querySelector('.ProseMirror')).toBeTruthy())
  return { ...view, onChange }
}

describe('EmailComposer', () => {
  it('RichTextEditor is the same component', () => {
    expect(RichTextEditor).toBe(EmailComposer)
  })

  it('renders legacy tokens as chips and exposes an accessible toolbar', async () => {
    const { container } = await mount('<p>Hi {{customer_name}}</p>')
    expect(container.querySelector('[data-variable-chip="customer_name"]')).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('inserts a variable from the API list and emits the plain {key}', async () => {
    const { onChange } = await mount()
    fireEvent.click(screen.getByRole('button', { name: /Insert variable/ }))
    const pick = await screen.findByText('{loyalty_tier}')
    expect(screen.getByText(/e\.g\. Gold/)).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/admin/template-variables', expect.anything())
    fireEvent.click(pick)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const html = onChange.mock.calls.at(-1)![0] as string
    expect(html).toContain('{loyalty_tier}')
    expect(html).not.toMatch(/<span|data-variable/)
  })

  it('falls back to the built-in list when the API is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 }))
    )
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /Insert variable/ }))
    expect(await screen.findByText('{customer_first_name}')).toBeTruthy()
  })

  it('filters variables by search', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /Insert variable/ }))
    await screen.findByText('{loyalty_tier}')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search variables' }), { target: { value: 'tier' } })
    expect(screen.queryByText('{store_name}')).toBeNull()
    expect(screen.getByText('{loyalty_tier}')).toBeTruthy()
  })

  it('link dialog rejects javascript: URLs', async () => {
    const { onChange } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'click' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert').textContent).toMatch(/not allowed/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('link dialog inserts a link and emits it', async () => {
    const { onChange } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Shop' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'shop.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)![0]).toContain('href="https://shop.test"')
  })

  it('opens complex HTML in source mode and edits it raw', async () => {
    const onChange = vi.fn()
    render(<EmailComposer value={'<div style="x"><p>Hi</p></div>'} onChange={onChange} />)
    const ta = screen.getByLabelText('Email HTML source') as HTMLTextAreaElement
    expect(ta.value).toContain('<div')
    fireEvent.change(ta, { target: { value: '<table></table>' } })
    expect(onChange).toHaveBeenCalledWith('<table></table>')
    fireEvent.click(screen.getByRole('button', { name: 'Visual editor' }))
    expect(screen.getByText(/will simplify or drop/)).toBeTruthy()
  })

  it('syncs an externally replaced value into the editor', async () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<EmailComposer value="<p>One</p>" onChange={onChange} />)
    await waitFor(() => expect(container.querySelector('.ProseMirror')?.textContent).toBe('One'))
    await act(async () => rerender(<EmailComposer value="<p>Two {store_name}</p>" onChange={onChange} />))
    await waitFor(() => expect(container.querySelector('[data-variable-chip="store_name"]')).toBeTruthy())
    expect(onChange).not.toHaveBeenCalled()
  })
})
