import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/admin/AutosaveStatusPill', () => ({ default: ({ status }: any) => <span data-testid="pill">{status}</span> }))

import {
  FormPage, FormSection, FormGrid, FormField, TextInput, NumberInput, MoneyInput, TextArea, FormButton, FormFooter,
} from '@/components/admin/kit/form'

afterEach(() => vi.restoreAllMocks())

describe('FormPage', () => {
  it('renders header, children and footer', () => {
    render(<FormPage header={<h1>Edit</h1>} footer={<footer>foot</footer>}><p>fields</p></FormPage>)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('fields')).toBeInTheDocument()
    expect(screen.getByText('foot')).toBeInTheDocument()
  })

  it('reports dirty on input and clean again on submit', () => {
    const onDirtyChange = vi.fn()
    render(
      <FormPage onDirtyChange={onDirtyChange}>
        <input aria-label="name" />
      </FormPage>
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.input(screen.getByLabelText('name'), { target: { value: 'x' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.submit(screen.getByLabelText('name'))
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('warns before unload only once dirty and guardUnload is on', () => {
    render(
      <FormPage guardUnload>
        <input aria-label="name" />
      </FormPage>
    )
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    fireEvent.input(screen.getByLabelText('name'), { target: { value: 'x' } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('FormSection / FormGrid / FormField', () => {
  it('renders a section with title, description and aside', () => {
    render(<FormSection title="Basics" description="Name it" aside={<span>aside</span>} id="basics"><p>child</p></FormSection>)
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeInTheDocument()
    expect(screen.getByText('Name it')).toBeInTheDocument()
    expect(screen.getByText('aside')).toBeInTheDocument()
    expect(document.getElementById('basics')).not.toBeNull()
  })

  it('collapsible sections are an open details with a summary', () => {
    const { container } = render(<FormSection title="Optional" collapsible><p>inner</p></FormSection>)
    const d = container.querySelector('details')!
    expect(d).toHaveAttribute('open')
    expect(d.querySelector('summary')).toHaveTextContent('Optional')
    expect(screen.getByText('inner')).toBeInTheDocument()
  })

  it('FormGrid sets columns', () => {
    const { container, rerender } = render(<FormGrid cols={3}><i /></FormGrid>)
    expect(container.firstElementChild).toHaveClass('md:grid-cols-3')
    rerender(<FormGrid cols={1}><i /></FormGrid>)
    expect(container.firstElementChild).not.toHaveClass('md:grid-cols-2')
  })

  it('FormField labels the control and shows hint, error and the required star', () => {
    render(
      <FormField label="Title" htmlFor="t" hint="Shown on the site" error="Required" required span={2}>
        <TextInput id="t" />
      </FormField>
    )
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('Shown on the site')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })
})

describe('inputs', () => {
  it('TextInput defaults to text and forwards props', () => {
    const onChange = vi.fn()
    render(<TextInput aria-label="n" placeholder="Name" onChange={onChange} />)
    const i = screen.getByLabelText('n')
    expect(i).toHaveAttribute('type', 'text')
    fireEvent.change(i, { target: { value: 'a' } })
    expect(onChange).toHaveBeenCalled()
  })

  it('NumberInput and MoneyInput are number inputs, money has the Rs prefix and 0.01 step', () => {
    render(
      <>
        <NumberInput aria-label="qty" />
        <MoneyInput aria-label="price" />
      </>
    )
    expect(screen.getByLabelText('qty')).toHaveAttribute('type', 'number')
    expect(screen.getByLabelText('price')).toHaveAttribute('step', '0.01')
    expect(screen.getByText('Rs')).toBeInTheDocument()
  })

  it('TextArea defaults to 3 rows', () => {
    render(<TextArea aria-label="desc" />)
    expect(screen.getByLabelText('desc')).toHaveAttribute('rows', '3')
  })
})

describe('FormButton', () => {
  it('submits by default and swaps the label while pending', () => {
    const { rerender } = render(<FormButton>Save</FormButton>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit')
    rerender(<FormButton pending pendingLabel="Saving...">Save</FormButton>)
    const b = screen.getByRole('button', { name: 'Saving...' })
    expect(b).toBeDisabled()
  })

  it('can be a secondary button', () => {
    render(<FormButton variant="secondary" type="button">Cancel</FormButton>)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('border')
  })
})

describe('FormFooter', () => {
  it('shows the submit label and runs a plain onCancel', () => {
    const onCancel = vi.fn()
    render(<FormFooter submitLabel="Save changes" onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('uses a cancel link when cancelHref is set', () => {
    render(<FormFooter cancelHref="/admin/x" cancelLabel="Back" />)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/admin/x')
  })

  it('shows the autosave pill, Unsaved changes, banner and Restore', () => {
    const restore = vi.fn()
    const { rerender } = render(<FormFooter dirty banner="Newer autosave" restore={restore} />)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByText('Newer autosave')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(restore).toHaveBeenCalledTimes(1)
    rerender(<FormFooter dirty autosave="saving" />)
    expect(screen.getByTestId('pill')).toHaveTextContent('saving')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('session cancel asks twice before cancelling', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    render(<FormFooter cancel={cancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes?' }))
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  })

  it('shows Discard draft and custom buttons', () => {
    const discard = vi.fn()
    render(
      <FormFooter discard={discard} secondary={<span>extra</span>}>
        <button>Publish</button>
      </FormFooter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(discard).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    expect(screen.getByText('extra')).toBeInTheDocument()
  })

  it('read-only lock hides save, shows who holds it, and Discard only for owners', () => {
    const discard = vi.fn()
    const lock: any = { readOnly: true, canDiscard: true, lock: { ownerId: 'a', ownerName: 'Priya', startedAt: new Date().toISOString(), closedAt: null } }
    const { rerender } = render(<FormFooter submitLabel="Save" lock={lock} discard={discard} cancelHref="/list" />)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByTestId('pill')).toHaveTextContent('locked')
    expect(screen.getByText(/Draft by Priya/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/list')
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(discard).toHaveBeenCalledTimes(1)
    rerender(<FormFooter lock={{ ...lock, canDiscard: false }} discard={discard} />)
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })
})
