import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LeadFormPart from '@/components/visitor/site/code/parts/showcase/LeadFormPart'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const base = { endpoint: '/api/leads', fields: ['name', 'phone', 'email', 'message'] as any, submitLabel: 'Send', successText: 'Thanks, we will call you.' }
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Send' }))

describe('LeadFormPart', () => {
  it('renders a field per configured input and a submit button', () => {
    render(<LeadFormPart {...base} messagePlaceholder="Tell us more" />)
    expect(screen.getByLabelText('Your name')).toBeRequired()
    expect(screen.getByLabelText('Phone')).toHaveAttribute('type', 'tel')
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Tell us more')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('renders only the configured fields', () => {
    render(<LeadFormPart {...base} fields={['name', 'email']} />)
    expect(screen.queryByLabelText('Phone')).toBeNull()
    expect(screen.queryByLabelText('Message')).toBeNull()
  })

  it('asks for a name before sending, marking the field invalid', () => {
    render(<LeadFormPart {...base} />)
    fill('Phone', '9876543210')
    submit()
    const name = screen.getByLabelText('Your name')
    expect(screen.getByText('Please tell us your name.')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates phone and email format and asks for a way to reach the visitor', () => {
    render(<LeadFormPart {...base} />)
    fill('Your name', 'Asha')
    fill('Phone', '12345')
    submit()
    expect(screen.getByText('Please check your phone number.')).toBeInTheDocument()
    fill('Phone', '')
    fill('Email', 'not-an-email')
    submit()
    expect(screen.getByText('Please check your email address.')).toBeInTheDocument()
    fill('Email', '')
    submit()
    expect(screen.getByText('Please leave a phone number so we can reach you.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks for an email when the form has no phone field', () => {
    render(<LeadFormPart {...base} fields={['name', 'email']} />)
    fill('Your name', 'Asha')
    submit()
    expect(screen.getByText('Please leave an email address so we can reach you.')).toBeInTheDocument()
  })

  it('posts the lead as JSON and shows the thank-you message', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<LeadFormPart {...base} />)
    fill('Your name', ' Asha ')
    fill('Phone', '98765 43210')
    fill('Message', 'Call after 5')
    submit()
    await screen.findByRole('status')
    expect(screen.getByText('Thanks, we will call you.')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/leads')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'Asha', phone: '98765 43210', message: 'Call after 5' })
  })

  it('shows the endpoint\'s message under the field it names', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'That number looks wrong.', field: 'contact' }) })
    render(<LeadFormPart {...base} />)
    fill('Your name', 'Asha')
    fill('Email', 'a@b.co')
    submit()
    expect(await screen.findByText('That number looks wrong.')).toBeInTheDocument()
    expect(screen.getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('shows a general error above the button when sending fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<LeadFormPart {...base} />)
    fill('Your name', 'Asha')
    fill('Email', 'a@b.co')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection and try again.')
  })

  it('falls back to a generic message when the endpoint gives none', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => null })
    render(<LeadFormPart {...base} />)
    fill('Your name', 'Asha')
    fill('Email', 'a@b.co')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your message could not be sent. Please try again.')
  })

  it('is inert in the studio preview (no endpoint): it validates and says so', async () => {
    render(<LeadFormPart {...base} endpoint={null} />)
    fill('Your name', 'Asha')
    fill('Email', 'a@b.co')
    submit()
    expect(await screen.findByText('This form starts working once your site is live.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears a field error as the visitor edits it', async () => {
    render(<LeadFormPart {...base} />)
    submit()
    expect(screen.getByText('Please tell us your name.')).toBeInTheDocument()
    fill('Your name', 'A')
    await waitFor(() => expect(screen.queryByText('Please tell us your name.')).toBeNull())
  })
})
