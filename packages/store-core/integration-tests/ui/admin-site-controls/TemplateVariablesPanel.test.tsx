import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// TemplateVariablesPanel: loads built-in + custom template variables on mount (GET
// /api/admin/template-variables), lists them, and adds/edits/deletes custom ones. fetch mocked.

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }), useToastOptional: () => null }))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import TemplateVariablesPanel from '@/components/admin/site-controls/TemplateVariablesPanel'

const loadBody = {
  variables: [
    { key: 'customer_first_name', label: 'First name', description: 'Buyer first name', sample: 'Aloys', builtIn: true },
  ],
  custom: [
    { id: 'c1', key: 'support_hours', label: 'Support hours', description: '', value: '9-5', isEnabled: true },
  ],
}

function routedFetch(custom = loadBody.custom) {
  return vi.fn<(...a: any[]) => any>().mockImplementation((_url: string, init?: any) => {
    if (!init || init.method === undefined || init.method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ variables: loadBody.variables, custom }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('TemplateVariablesPanel', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('lists built-in and custom variables after load', async () => {
    vi.stubGlobal('fetch', routedFetch())
    render(<TemplateVariablesPanel />)
    await waitFor(() => expect(screen.getByText('First name')).toBeInTheDocument())
    expect(screen.getByText('{customer_first_name}')).toBeInTheDocument()
    expect(screen.getByText('e.g. Aloys')).toBeInTheDocument()
    expect(screen.getByText('Support hours')).toBeInTheDocument()
    expect(screen.getByText('{support_hours}')).toBeInTheDocument()
  })

  it('shows the no-custom-variables note when the custom list is empty', async () => {
    vi.stubGlobal('fetch', routedFetch([]))
    render(<TemplateVariablesPanel />)
    await waitFor(() => expect(screen.getByText('No custom variables yet.')).toBeInTheDocument())
  })

  it('opens the add form and blocks save while the key is invalid', async () => {
    vi.stubGlobal('fetch', routedFetch([]))
    render(<TemplateVariablesPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add variable' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    const keyInput = screen.getByPlaceholderText(/key \(e.g. support_hours\)/)
    // A built-in key is rejected with an inline error; Save stays disabled.
    fireEvent.change(keyInput, { target: { value: 'store_name' } })
    expect(screen.getByText('That key is a built-in variable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('POSTs a valid new custom variable', async () => {
    const fetchMock = routedFetch([])
    vi.stubGlobal('fetch', fetchMock)
    render(<TemplateVariablesPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add variable' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    fireEvent.change(screen.getByPlaceholderText(/key \(e.g. support_hours\)/), { target: { value: 'hours' } })
    fireEvent.change(screen.getByPlaceholderText(/Label/), { target: { value: 'Hours' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post![1].body)).toMatchObject({ key: 'hours', label: 'Hours' })
    })
  })

  it('lowercases and underscores the typed key', async () => {
    vi.stubGlobal('fetch', routedFetch([]))
    render(<TemplateVariablesPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add variable' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    const keyInput = screen.getByPlaceholderText(/key \(e.g. support_hours\)/) as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'Support Hours' } })
    expect(keyInput.value).toBe('support_hours')
  })

  it('DELETEs a custom variable', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<TemplateVariablesPanel />)
    await waitFor(() => expect(screen.getByText('Support hours')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => c[1]?.method === 'DELETE')
      expect(del).toBeTruthy()
      expect(del![0]).toContain('/api/admin/template-variables/c1')
    })
  })

  it('hides the Add/Edit/Delete controls when the admin cannot write', async () => {
    canWrite = false
    vi.stubGlobal('fetch', routedFetch())
    render(<TemplateVariablesPanel />)
    await waitFor(() => expect(screen.getByText('Support hours')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Add variable' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
