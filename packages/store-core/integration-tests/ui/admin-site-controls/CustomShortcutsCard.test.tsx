import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// CustomShortcutsCard: an editable list of custom admin keyboard shortcuts, persisted as a single
// shortcut_custom setting (PATCH /api/admin/settings). Contexts mocked; fetch mocked for persistence.

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => canWrite,
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))

import CustomShortcutsCard, { type CustomShortcut } from '@/components/admin/site-controls/CustomShortcutsCard'

const shortcut = (over: Partial<CustomShortcut> = {}): CustomShortcut => ({
  id: 's1',
  label: 'Orders',
  path: '/admin/orders',
  combo: 'mod+o',
  ...over,
})

function okFetch() {
  return vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
}

describe('CustomShortcutsCard', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
    ;(window as any).__jeffiShortcutRegistry = undefined
    ;(window as any).__jeffiCustomShortcutList = undefined
  })

  it('shows the empty hint when there are no shortcuts', () => {
    render(<CustomShortcutsCard initial={[]} isMac={false} />)
    expect(screen.getByText(/No custom shortcuts yet/)).toBeInTheDocument()
  })

  it('renders a row per shortcut with its label, path and combo preview', () => {
    render(<CustomShortcutsCard initial={[shortcut()]} isMac={false} />)
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.getByText('/admin/orders')).toBeInTheDocument()
    // mod+o -> Ctrl+O on a non-Mac.
    expect(screen.getByText('Ctrl+O')).toBeInTheDocument()
  })

  it('warns when a shortcut has no key set', () => {
    render(<CustomShortcutsCard initial={[shortcut({ combo: 'mod+' })]} isMac={false} />)
    expect(screen.getByText(/Some shortcuts have no key set/)).toBeInTheDocument()
  })

  it('disables Add until both label and path are filled', () => {
    render(<CustomShortcutsCard initial={[]} isMac={false} />)
    const add = screen.getByRole('button', { name: 'Add' })
    const pathInput = screen.getByPlaceholderText(/\/admin\//)
    // Path is pre-filled with "/admin/" but the label is empty, so Add starts disabled.
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Stock' } })
    // Label + the default path => enabled.
    expect(add).not.toBeDisabled()
    // Clearing the path disables it again.
    fireEvent.change(pathInput, { target: { value: '' } })
    expect(add).toBeDisabled()
  })

  it('adds a new shortcut row and persists the list', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<CustomShortcutsCard initial={[]} isMac={false} />)
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Stock' } })
    fireEvent.change(screen.getByPlaceholderText(/\/admin\//), { target: { value: '/admin/stock' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Stock')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.key).toBe('shortcut_custom')
    const saved = JSON.parse(body.value)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ label: 'Stock', path: '/admin/stock' })
  })

  it('normalises a pasted admin URL into a path', () => {
    render(<CustomShortcutsCard initial={[]} isMac={false} />)
    const pathInput = screen.getByPlaceholderText(/\/admin\//) as HTMLInputElement
    fireEvent.change(pathInput, { target: { value: 'https://admin.shop.test/orders?x=1' } })
    expect(pathInput.value).toBe('/admin/orders?x=1')
  })

  it('removes a shortcut and persists the shorter list', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<CustomShortcutsCard initial={[shortcut()]} isMac={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('Orders')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body).value)).toHaveLength(0)
  })

  it('hides the Remove button when the admin cannot write', () => {
    canWrite = false
    render(<CustomShortcutsCard initial={[shortcut()]} isMac={false} />)
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })
})
