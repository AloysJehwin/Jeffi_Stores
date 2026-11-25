import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import AdminShortcutHandler from '@/components/admin/AdminShortcutHandler'

const blank = {
  newProduct: '', cashSale: '', quotation: '', newPo: '', orders: '', packingSlips: '', returns: '', gst: '',
  labels: '', inventory: '', coupons: '', campaign: '', financial: '', customers: '', crm: '', reviews: '', aiAgent: '',
  customShortcuts: '',
}

function mount(over: Partial<typeof blank> = {}, role = 'ops_manager', scopes: string[] = ['orders:read', 'products:write'], host = 'shop.test') {
  return render(<AdminShortcutHandler shortcuts={{ ...blank, ...over }} host={host} role={role} scopes={scopes} />)
}

const key = (k: string, init: KeyboardEventInit = {}, target: Element | Document = document) =>
  fireEvent.keyDown(target, { key: k, ...init })

describe('AdminShortcutHandler', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('renders nothing visible', () => {
    const { container } = mount()
    expect(container.firstChild).toBeNull()
  })

  it('navigates on Cmd/Ctrl+key for a built-in shortcut', () => {
    mount({ orders: 'mod+o' })
    key('o', { metaKey: true })
    expect(push).toHaveBeenCalledWith('/admin/orders')
    key('o', { ctrlKey: true })
    expect(push).toHaveBeenCalledTimes(2)
  })

  it('supports mod+shift and F-key combos and a bare letter meaning mod+letter', () => {
    mount({ orders: 'mod+shift+o', newProduct: 'f2' }, 'ops_manager', ['orders:read', 'products:write'])
    key('o', { metaKey: true })
    expect(push).not.toHaveBeenCalled()
    key('o', { metaKey: true, shiftKey: true })
    expect(push).toHaveBeenLastCalledWith('/admin/orders')
    key('F2')
    expect(push).toHaveBeenLastCalledWith('/admin/products/add')
    key('F2', { ctrlKey: true })
    expect(push).toHaveBeenCalledTimes(2)
  })

  it('a plain mod combo does not fire with shift held', () => {
    mount({ orders: 'o' })
    key('o', { metaKey: true, shiftKey: true })
    expect(push).not.toHaveBeenCalled()
    key('o', { metaKey: true })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('skips shortcuts for scopes the session lacks', () => {
    mount({ gst: 'mod+g' }, 'ops_manager', ['orders:read'])
    key('g', { metaKey: true })
    expect(push).not.toHaveBeenCalled()
  })

  it('a platform admin reaches every built-in shortcut', () => {
    mount({ gst: 'mod+g' }, 'administrator', [])
    key('g', { metaKey: true })
    expect(push).toHaveBeenCalledWith('/admin/gst')
  })

  it('ignores key presses inside inputs, textareas and selects', () => {
    mount({ orders: 'mod+o' })
    const input = document.createElement('input')
    document.body.appendChild(input)
    key('o', { metaKey: true, bubbles: true }, input)
    expect(push).not.toHaveBeenCalled()
    input.remove()
  })

  it('custom shortcuts route to their path and win over built-ins on the same keys', () => {
    mount({
      orders: 'mod+k',
      customShortcuts: JSON.stringify([{ id: 'a', label: 'Wallet', path: '/admin/wallet', combo: 'mod+k' }]),
    })
    key('k', { metaKey: true })
    expect(push).toHaveBeenCalledWith('/admin/wallet')
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed custom shortcut JSON and unparseable combos', () => {
    mount({ customShortcuts: '{not json', orders: 'banana' })
    key('b', { metaKey: true })
    expect(push).not.toHaveBeenCalled()
  })

  it('strips the /admin prefix on an admin host', () => {
    mount({ orders: 'mod+o' }, 'ops_manager', ['orders:read'], 'admin.shop.test')
    key('o', { metaKey: true })
    expect(push).toHaveBeenCalledWith('/orders')
  })

  it('removes its listener on unmount', () => {
    const { unmount } = mount({ orders: 'mod+o' })
    unmount()
    key('o', { metaKey: true })
    expect(push).not.toHaveBeenCalled()
  })
})
