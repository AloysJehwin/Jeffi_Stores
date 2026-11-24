import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true, useHasScope: () => true }))

import CustomerTagDefinitionsCard from '@/components/admin/CustomerTagDefinitionsCard'

const defs = [
  { id: 't1', tag: 'vip', color: 'gold', sort_order: 1 },
  { id: 't2', tag: 'wholesale', color: 'blue', sort_order: 2 },
]

describe('CustomerTagDefinitionsCard', () => {
  let tags: typeof defs
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    tags = [...defs]
    fetchMock = vi.fn<(...a: any[]) => any>().mockImplementation(async (_url: string, init?: any) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => ({ definitions: tags }) }
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists the defined tags', async () => {
    render(<CustomerTagDefinitionsCard isSuperAdmin={false} />)
    expect(await screen.findByText('vip')).toBeInTheDocument()
    expect(screen.getByText('wholesale')).toBeInTheDocument()
    expect(screen.getByText('Customer Tags')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    tags = []
    render(<CustomerTagDefinitionsCard isSuperAdmin={false} />)
    expect(await screen.findByText('No tags defined yet.')).toBeInTheDocument()
  })

  it('hides add and remove controls for non super admins', async () => {
    render(<CustomerTagDefinitionsCard isSuperAdmin={false} />)
    await screen.findByText('vip')
    expect(screen.queryByPlaceholderText(/New tag name/)).toBeNull()
    expect(screen.queryByLabelText('Remove vip')).toBeNull()
  })

  it('adds a tag with the chosen colour and reloads', async () => {
    render(<CustomerTagDefinitionsCard isSuperAdmin />)
    await screen.findByText('vip')
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    const input = screen.getByPlaceholderText(/New tag name/)
    fireEvent.change(input, { target: { value: ' prospect ' } })
    fireEvent.click(screen.getByTitle('teal'))
    tags = [...defs, { id: 't3', tag: 'prospect', color: 'teal', sort_order: 3 }]
    fireEvent.click(add)
    expect(await screen.findAllByText('prospect')).not.toHaveLength(0)
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('/api/admin/customer-tag-definitions')
    expect(JSON.parse(post[1].body)).toEqual({ tag: 'prospect', color: 'teal' })
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('adds on Enter', async () => {
    render(<CustomerTagDefinitionsCard isSuperAdmin />)
    await screen.findByText('vip')
    const input = screen.getByPlaceholderText(/New tag name/)
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(true))
  })

  it('toasts the API error when adding fails', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) =>
      init?.method === 'POST'
        ? { ok: false, json: async () => ({ error: 'Tag exists' }) }
        : { ok: true, json: async () => ({ definitions: tags }) }
    )
    render(<CustomerTagDefinitionsCard isSuperAdmin />)
    await screen.findByText('vip')
    fireEvent.change(screen.getByPlaceholderText(/New tag name/), { target: { value: 'vip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Tag exists', 'error'))
  })

  it('removes a tag with DELETE and reloads', async () => {
    render(<CustomerTagDefinitionsCard isSuperAdmin />)
    await screen.findByText('vip')
    tags = [defs[1]]
    fireEvent.click(screen.getByLabelText('Remove vip'))
    await waitFor(() => expect(screen.queryByText('vip')).toBeNull())
    const del = fetchMock.mock.calls.find(c => c[1]?.method === 'DELETE')!
    expect(del[0]).toBe('/api/admin/customer-tag-definitions?id=t1')
  })
})
