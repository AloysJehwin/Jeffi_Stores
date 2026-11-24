import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('status=interested') }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))

import OutreachProgramClient from '@controller/app/(admin)/admin/ecom/outreach/OutreachProgramClient'
import OutreachListsClient from '@controller/app/(admin)/admin/ecom/outreach/OutreachListsClient'
import OutreachContactsClient from '@controller/app/(admin)/admin/ecom/outreach/OutreachContactsClient'
import OutreachSuppressionsClient from '@controller/app/(admin)/admin/ecom/outreach/OutreachSuppressionsClient'
import ContactDetailClient, { linksFromEvents } from '@controller/app/(admin)/admin/ecom/outreach/ContactDetailClient'
import CallPanelClient, { transcriptTurns } from '@controller/app/(admin)/admin/ecom/outreach/CallPanelClient'
import { maskPhone } from '@controller/app/(admin)/admin/ecom/outreach/shared'

const calls: { url: string; init?: RequestInit }[] = []
let routes: Record<string, (init?: RequestInit) => unknown> = {}

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(routes).find(k => `${init?.method ?? 'GET'} ${url}`.startsWith(k))
      const body = key ? routes[key](init) : { error: 'no route' }
      const ok = !(body && typeof body === 'object' && 'error' in (body as object))
      return { ok, json: async () => body } as Response
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const state = { program: 'showcase-offer', enabled: false, daily_cap: 100, concurrency: 2, window_start: '09:30', window_end: '20:30', test_numbers: ['+919876543210'], updated_at: '', updated_by: null }
const contact = (o: object = {}) => ({
  id: 'c1', list_id: null, program: 'showcase-offer', phone: '+919876543210', business_name: 'Acme Sweets', owner_name: null, category: null, city: 'Pune', address: null, language: 'hi',
  source: 'upload', extra: {}, status: 'interested', attempts: 1, next_attempt_at: null, last_call_id: null, showcase_site_id: 's1', claim_token_hash: 'x', claimed_owner_id: null,
  consent_whatsapp_at: '2026-11-24T10:00:00Z', consent_evidence: { said: 'yes' }, opted_out_at: null, dnd_status: 'clear', dnd_checked_at: null, wa_window_expires_at: null, created_at: '', updated_at: '', ...o,
})

describe('helpers', () => {
  it('masks a phone to the last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('••••3210')
    expect(maskPhone(null)).toBe('-')
  })
  it('reads transcripts and links tolerantly', () => {
    expect(transcriptTurns([{ role: 'agent', text: 'Hi' }, { speaker: 'user', content: '' }])).toEqual([{ who: 'agent', text: 'Hi' }])
    expect(transcriptTurns('not json')).toEqual([])
    const ev = (data: Record<string, unknown>) => ({ id: 1, contact_id: 'c1', call_id: null, kind: 'k', data, actor: null, created_at: '' })
    expect(linksFromEvents([ev({ previewUrl: 'https://p' }), ev({ liveUrl: 'https://l' }), ev({ previewUrl: 'https://old' })])).toEqual({ preview: 'https://p', live: 'https://l' })
  })
})

describe('OutreachProgramClient', () => {
  it('saves the enable switch and fires a test call', async () => {
    routes = {
      'GET /api/admin/ecom/outreach/program': () => ({ program: { key: 'showcase-offer', title: 'Showcase offer' }, state, counts: { queued: 3 } }),
      'PATCH /api/admin/ecom/outreach/program': () => ({ state: { ...state, enabled: true } }),
      'POST /api/admin/ecom/outreach/test-call': () => ({ callId: 'call9' }),
    }
    render(<OutreachProgramClient />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy())
    expect(JSON.parse(calls.find(c => c.init?.method === 'PATCH')!.init!.body as string)).toEqual({ enabled: true })

    fireEvent.click(screen.getByRole('button', { name: 'Test call' }))
    const link = await screen.findByRole('link', { name: 'View call' })
    expect(link.getAttribute('href')).toBe('/admin/ecom/outreach/calls/call9')
    expect(JSON.parse(calls.find(c => c.url.endsWith('/test-call'))!.init!.body as string)).toEqual({ phone: '+919876543210', language: 'en' })
  })

  it('blocks a test number that is not E.164', async () => {
    routes = { 'GET /api/admin/ecom/outreach/program': () => ({ program: { key: 'k', title: 'T' }, state, counts: {} }) }
    render(<OutreachProgramClient />)
    fireEvent.change(await screen.findByLabelText('Test numbers'), { target: { value: '98765' } })
    expect(screen.getByText(/not in E.164 form/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save numbers' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('OutreachListsClient', () => {
  it('connects a sheet and shows rejected rows with reasons', async () => {
    routes = {
      'GET /api/admin/ecom/outreach/lists': () => ({ lists: [{ id: 'l1', name: 'Pune', source: 'google_sheet', row_count: 12, last_synced_at: null, created_at: '' }] }),
      'POST /api/admin/ecom/outreach/lists': () => ({ list: {}, summary: { total: 3, inserted: 1, updated: 1, rejected: 1, rejections: [{ row: 4, reason: 'Not a valid Indian mobile number', phone: '12' }] } }),
    }
    render(<OutreachListsClient />)
    await screen.findByText('Pune')
    fireEvent.change(screen.getByLabelText('Sheet list name'), { target: { value: 'New' } })
    fireEvent.change(screen.getByLabelText('Sheet link'), { target: { value: 'https://docs.google.com/spreadsheets/d/abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect and sync' }))
    expect(await screen.findByText('Not a valid Indian mobile number')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy()
  })
})

describe('OutreachContactsClient', () => {
  it('filters by the status in the URL, masks phones and toggles chips', async () => {
    routes = { 'GET /api/admin/ecom/outreach/contacts': () => ({ rows: [contact()], total: 1, page: 1, pageSize: 50 }) }
    render(<OutreachContactsClient />)
    await waitFor(() => expect(calls[0].url).toContain('status=interested'))
    expect((await screen.findAllByText('••••3210')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Interested' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Queued' }))
    await waitFor(() => expect(calls[calls.length - 1].url).toContain('status=interested%2Cqueued'))
  })
})

describe('OutreachSuppressionsClient', () => {
  it('adds and removes a suppression', async () => {
    routes = {
      'GET /api/admin/ecom/outreach/suppressions': () => ({ rows: [{ phone: '+919000000001', reason: 'asked', source: 'admin', created_at: '' }], total: 1 }),
      'POST /api/admin/ecom/outreach/suppressions': () => ({ phone: '+919000000002' }),
      'DELETE /api/admin/ecom/outreach/suppressions': () => ({ ok: true }),
    }
    render(<OutreachSuppressionsClient />)
    await screen.findByText('+919000000001')
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9000000002' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suppress' }))
    await waitFor(() => expect(calls.some(c => c.init?.method === 'POST')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Remove suppression' }))
    await waitFor(() => expect(calls.some(c => c.init?.method === 'DELETE')).toBe(true))
  })
})

describe('Contact detail and call panel', () => {
  it('shows the timeline, consent, links and loads a call with its recording', async () => {
    routes = {
      'GET /api/admin/ecom/outreach/contacts/c1': () => ({
        contact: contact(),
        calls: [{ id: 'k1', status: 'completed', outcome: 'interested', created_at: '2026-11-24T10:00:00Z', started_at: null }],
        messages: [{ id: 'm1', direction: 'out', template_slug: 'preview', body: 'Your site', status: 'sent', created_at: '' }],
        events: [
          { id: 2, contact_id: 'c1', call_id: null, kind: 'published', data: { claimLinkCreated: true, claimExpiresAt: '2026-12-08T00:00:00.000Z' }, actor: 'build', created_at: '2026-11-24T10:05:00Z' },
          { id: 1, contact_id: 'c1', call_id: null, kind: 'preview.minted', data: { previewUrl: 'https://preview.example/x' }, actor: 'system', created_at: '2026-11-24T10:00:00Z' },
        ],
      }),
      'GET /api/admin/ecom/outreach/calls/k1': () => ({ call: { id: 'k1', status: 'completed', outcome: 'interested', created_at: '', transcript: [{ role: 'agent', text: 'Namaste' }], consent: { recorded: true } }, recordingUrl: 'https://rec.example/a.mp3', events: [] }),
    }
    const { container } = render(<ContactDetailClient contactId="c1" />)
    await screen.findByText('Acme Sweets')
    expect(screen.getByText('preview minted')).toBeTruthy()
    expect(screen.getByText(/^Claim link sent · expires /)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'https://preview.example/x' })).toBeTruthy()
    expect(screen.getByText(/Given/)).toBeTruthy()
    expect(screen.getByText('Your site')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript and recording' }))
    expect(await screen.findByText('Namaste')).toBeTruthy()
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('https://rec.example/a.mp3')
  })

  it('requeues through PATCH', async () => {
    routes = {
      'GET /api/admin/ecom/outreach/contacts/c1': () => ({ contact: contact({ status: 'no_answer' }), calls: [], messages: [], events: [] }),
      'PATCH /api/admin/ecom/outreach/contacts/c1': () => ({ contact: contact({ status: 'queued' }), calls: [], messages: [], events: [] }),
    }
    render(<ContactDetailClient contactId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Requeue' }))
    await waitFor(() => expect(screen.getAllByText('Queued').length).toBeGreaterThan(0))
  })

  it('reports a call that fails to load', async () => {
    routes = { 'GET /api/admin/ecom/outreach/calls/zz': () => ({ error: 'Call not found' }) }
    render(<CallPanelClient callId="zz" defaultOpen />)
    expect(await screen.findByText('Call not found')).toBeTruthy()
    expect(within(document.body).queryByRole('button')).toBeNull()
  })
})
