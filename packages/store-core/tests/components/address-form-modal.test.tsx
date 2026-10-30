import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/ToastContext', () => {
  const toast = { showToast: vi.fn() }
  return { useToast: () => toast }
})
vi.mock('@/contexts/AuthContext', () => {
  const auth = { user: { firstName: 'Asha', lastName: 'K', phone: '+919999999999' } }
  return { useAuth: () => auth }
})
vi.mock('@/components/visitor/CustomSelect', () => ({ default: () => <div data-testid="select" /> }))

const attachedInputs: HTMLInputElement[] = []

class FakeAutocomplete {
  constructor(input: HTMLInputElement) {
    attachedInputs.push(input)
  }
  addListener() {}
  getPlace() {
    return {}
  }
}

async function renderModal(isOpen = true) {
  const { default: AddressFormModal } = await import('@/components/visitor/AddressFormModal')
  const props = { onClose: vi.fn(), onSaved: vi.fn() }
  const view = render(<AddressFormModal isOpen={isOpen} {...props} />)
  return {
    reopen: (open: boolean) => view.rerender(<AddressFormModal isOpen={open} {...props} />),
  }
}

const addressInput = () => document.getElementById('modal_address_line1') as HTMLInputElement

// What Google's script does to an input when it rejects the key for this host.
function googleRefusesTheKey(input: HTMLInputElement) {
  input.disabled = true
  input.placeholder = 'Oops! Something went wrong.'
  input.classList.add('gm-err-autocomplete')
  act(() => window.gm_authFailure!())
}

describe('AddressFormModal address autocomplete', () => {
  beforeEach(() => {
    vi.resetModules()
    attachedInputs.length = 0
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key'
    ;(window as any).google = { maps: { places: { Autocomplete: FakeAutocomplete } } }
    delete window.gm_authFailure
  })

  afterEach(() => {
    cleanup()
    delete (window as any).google
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  })

  it('attaches Google autocomplete to the address field when the form opens', async () => {
    await renderModal()
    expect(attachedInputs).toEqual([addressInput()])
    expect(typeof window.gm_authFailure).toBe('function')
  })

  it('does not load Google Maps at all when no key is configured', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    await renderModal()
    expect(attachedInputs).toHaveLength(0)
    expect(window.gm_authFailure).toBeUndefined()
  })

  it('keeps the address field usable when Google refuses the key', async () => {
    await renderModal()
    const refused = addressInput()
    fireEvent.change(refused, { target: { value: '12 Anna Salai' } })

    googleRefusesTheKey(refused)

    const field = addressInput()
    expect(field).not.toBe(refused)
    expect(field.disabled).toBe(false)
    expect(field.placeholder).toBe('Start typing your street address…')
    expect(field.classList.contains('gm-err-autocomplete')).toBe(false)
    expect(field.value).toBe('12 Anna Salai')
    expect(document.activeElement).toBe(field)
  })

  it('does not steal focus from another field the customer has moved to', async () => {
    await renderModal()
    const other = document.getElementById('modal_postal_code') as HTMLInputElement
    other.focus()

    googleRefusesTheKey(addressInput())

    expect(document.activeElement).toBe(other)
  })

  it('never attaches autocomplete again after a refusal, even when the form is reopened', async () => {
    const view = await renderModal()
    googleRefusesTheKey(addressInput())
    expect(attachedInputs).toHaveLength(1)

    view.reopen(false)
    view.reopen(true)

    expect(attachedInputs).toHaveLength(1)
    expect(addressInput().disabled).toBe(false)
  })
})
