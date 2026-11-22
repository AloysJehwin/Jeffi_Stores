import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Shared auto-save primitives for Site Controls. ToastContext + AdminScopesContext are mocked;
// the PATCH /api/admin/settings call is a mocked global.fetch so we can prove the key/value sent.

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => canWrite,
  RequireWrite: ({ children }: any) => <>{children}</>,
}))

// next/navigation router.refresh is called by refreshOnSave fields.
const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import {
  SectionCard,
  FullSpan,
  TextControl,
  NumberControl,
  ToggleControl,
  SelectControl,
} from '@/components/admin/site-controls/controls'

function okFetch(ok = true) {
  return vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok, json: async () => ({}) })
}

describe('SectionCard + FullSpan', () => {
  it('renders title, description and children', () => {
    render(
      <SectionCard title="Appearance" description="How the store looks">
        <p>inner</p>
      </SectionCard>
    )
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByText('How the store looks')).toBeInTheDocument()
    expect(screen.getByText('inner')).toBeInTheDocument()
  })

  it('omits the description paragraph when none is given', () => {
    render(
      <SectionCard title="Bare">
        <span>x</span>
      </SectionCard>
    )
    expect(screen.getByRole('heading', { name: 'Bare' })).toBeInTheDocument()
    // Only the heading text, no extra description node.
    expect(screen.queryByText('How the store looks')).not.toBeInTheDocument()
  })

  it('FullSpan wraps its children', () => {
    render(<FullSpan><button>act</button></FullSpan>)
    expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument()
  })
})

describe('TextControl', () => {
  beforeEach(() => {
    showToast.mockReset()
    refresh.mockReset()
    canWrite = true
  })

  it('renders label, hint and the initial value', () => {
    render(<TextControl settingKey="store_name" label="Store name" hint="Shown in header" initial="Acme" />)
    expect(screen.getByText('Store name')).toBeInTheDocument()
    expect(screen.getByText('Shown in header')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument()
  })

  it('does not save on blur when the value is unchanged', () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<TextControl settingKey="store_name" label="Store name" initial="Acme" />)
    fireEvent.blur(screen.getByDisplayValue('Acme'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PATCHes the new value on blur and toasts Saved', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<TextControl settingKey="store_name" label="Store name" initial="Acme" />)
    const input = screen.getByDisplayValue('Acme')
    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.blur(input)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ key: 'store_name', value: 'Beta' })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved', 'success'))
  })

  it('refreshes the router after a save when refreshOnSave is set', async () => {
    vi.stubGlobal('fetch', okFetch())
    render(<TextControl settingKey="store_name" label="Store name" initial="Acme" refreshOnSave />)
    const input = screen.getByDisplayValue('Acme')
    fireEvent.change(input, { target: { value: 'Gamma' } })
    fireEvent.blur(input)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('disables the input when the admin cannot write', () => {
    canWrite = false
    render(<TextControl settingKey="store_name" label="Store name" initial="Acme" />)
    expect(screen.getByDisplayValue('Acme')).toBeDisabled()
  })
})

describe('NumberControl', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
  })

  it('renders prefix/suffix and the initial number as a string', () => {
    render(<NumberControl settingKey="min_order" label="Minimum" initial={500} prefix="₹" suffix="only" />)
    expect(screen.getByDisplayValue('500')).toBeInTheDocument()
    expect(screen.getByText('₹')).toBeInTheDocument()
    expect(screen.getByText('only')).toBeInTheDocument()
  })

  it('saves the parsed number on blur', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<NumberControl settingKey="min_order" label="Minimum" initial={500} />)
    const input = screen.getByDisplayValue('500')
    fireEvent.change(input, { target: { value: '750' } })
    fireEvent.blur(input)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ key: 'min_order', value: '750' })
  })

  it('reverts to the saved value and does not save when emptied', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<NumberControl settingKey="min_order" label="Minimum" initial={500} />)
    const input = screen.getByDisplayValue('500') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(input.value).toBe('500')
  })
})

describe('ToggleControl', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
  })

  it('renders the label, hint and a switch reflecting the initial state', () => {
    render(<ToggleControl settingKey="guest_checkout" label="Guest checkout" hint="Allow buying without login" initial={true} />)
    expect(screen.getByText('Guest checkout')).toBeInTheDocument()
    expect(screen.getByText('Allow buying without login')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('toggles and PATCHes the boolean as a string', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<ToggleControl settingKey="guest_checkout" label="Guest checkout" initial={false} />)
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ key: 'guest_checkout', value: 'true' })
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
  })

  it('shows the locked hint and does not save when locked', () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ToggleControl settingKey="guest_checkout" label="Guest checkout" hint="h" locked lockedHint="Upgrade to unlock" initial={false} />
    )
    expect(screen.getByText('Upgrade to unlock')).toBeInTheDocument()
    expect(screen.queryByText('h')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SelectControl', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
  })

  it('renders the label and the current option label', () => {
    render(
      <SelectControl
        settingKey="messaging_provider"
        label="Messaging provider"
        hint="Who sends SMS"
        initial="twilio"
        options={[{ value: 'twilio', label: 'Twilio' }, { value: 'aws', label: 'AWS' }]}
      />
    )
    expect(screen.getByText('Messaging provider')).toBeInTheDocument()
    expect(screen.getByText('Who sends SMS')).toBeInTheDocument()
    // AdminSelect shows the selected option's label on its trigger.
    expect(screen.getByText('Twilio')).toBeInTheDocument()
  })
})
