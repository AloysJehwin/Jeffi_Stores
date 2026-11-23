import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AccountAddressForm, { type AddressFormData } from '@/components/shared/AccountAddressForm'

// Controlled address form: all state lives in props. Tests prove the inputs emit the right
// setFormData patches, submit/cancel fire, and the PIN-lookup states drive the right UI.

function baseData(overrides: Partial<AddressFormData> = {}): AddressFormData {
  return {
    address_type: 'shipping',
    full_name: '',
    address_line1: '',
    address_line2: '',
    landmark: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'India',
    phone: '',
    is_default: false,
    ...overrides,
  }
}

function setup(props: Partial<React.ComponentProps<typeof AccountAddressForm>> = {}) {
  const setFormData = vi.fn()
  const onPincodeChange = vi.fn()
  const onSubmit = vi.fn(e => e.preventDefault())
  const onCancel = vi.fn()
  render(
    <AccountAddressForm
      formData={baseData(props.formData as Partial<AddressFormData>)}
      setFormData={setFormData}
      editing={false}
      isSaving={false}
      pinLookupState="idle"
      localities={[]}
      onPincodeChange={onPincodeChange}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />
  )
  return { setFormData, onPincodeChange, onSubmit, onCancel }
}

describe('AccountAddressForm', () => {
  it('renders the add heading and Save button when not editing', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Add New Address' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Address' })).toBeInTheDocument()
  })

  it('renders the edit heading and Update button when editing', () => {
    setup({ editing: true })
    expect(screen.getByRole('heading', { name: 'Edit Address' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update Address' })).toBeInTheDocument()
  })

  it('patches full_name on change', () => {
    const { setFormData } = setup()
    fireEvent.change(screen.getByLabelText('Full Name *'), { target: { value: 'Asha' } })
    expect(setFormData).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Asha' }))
  })

  it('strips non-digits from the phone field', () => {
    const { setFormData } = setup()
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '98a7b6' } })
    expect(setFormData).toHaveBeenCalledWith(expect.objectContaining({ phone: '9876' }))
  })

  it('shows a phone validation message for an incomplete number', () => {
    setup({ formData: baseData({ phone: '98765' }) })
    expect(screen.getByText('Enter a valid 10-digit mobile number')).toBeInTheDocument()
  })

  it('no phone validation message for a complete 10-digit number', () => {
    setup({ formData: baseData({ phone: '9876543210' }) })
    expect(screen.queryByText('Enter a valid 10-digit mobile number')).not.toBeInTheDocument()
  })

  it('routes PIN input through onPincodeChange (not setFormData)', () => {
    const { onPincodeChange } = setup()
    fireEvent.change(screen.getByLabelText('PIN Code *'), { target: { value: '560001' } })
    expect(onPincodeChange).toHaveBeenCalledWith('560001')
  })

  it('shows the PIN-not-found error in the error state', () => {
    setup({ pinLookupState: 'error' })
    expect(screen.getByText(/PIN code not found/)).toBeInTheDocument()
  })

  it('makes city/state read-only once the PIN is found', () => {
    setup({ pinLookupState: 'found', formData: baseData({ city: 'Bengaluru', state: 'Karnataka' }) })
    expect(screen.getByLabelText('City / District *')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('State *')).toHaveAttribute('readonly')
  })

  it('renders a free-text locality input when there are no localities', () => {
    setup({ localities: [] })
    expect(screen.getByLabelText('Locality / Village')).toBeInTheDocument()
  })

  it('toggles is_default via the checkbox', () => {
    const { setFormData } = setup()
    fireEvent.click(screen.getByLabelText('Set as default address'))
    expect(setFormData).toHaveBeenCalledWith(expect.objectContaining({ is_default: true }))
  })

  it('fires onSubmit when the form is submitted', () => {
    const { onSubmit } = setup()
    const form = screen.getByRole('button', { name: 'Save Address' }).closest('form')!
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('fires onCancel when Cancel is clicked', () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables the buttons and shows Saving... while saving', () => {
    setup({ isSaving: true })
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
