import { describe, it, expect, vi } from 'vitest'

// A Showcase's analytics maths: how a visit's landing is classified, the Needs attention rules, funnel roll-ups and the
// enquiries export.

vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query: vi.fn() }), RESERVED_LABELS: new Set<string>() }))

import { classifyChannel } from '@/lib/traffic/channels'
import { attribution, funnelBy, leadsCsv, showcaseAttention } from '@/lib/traffic/showcase-report'
import type { LeadRow, ShowcaseTotals } from '@/lib/traffic/showcase-types'

const ZERO: ShowcaseTotals = {
  visitors: 0,
  sessions: 0,
  newVisitors: 0,
  pageviews: 0,
  engagedSessions: 0,
  engagedMs: 0,
  scrollSum: 0,
  contactSessions: 0,
  formStarts: 0,
  formSubmits: 0,
  leadSessions: 0,
  convertedSessions: 0,
  leads: 0,
}
const tabHref = (t: string) => `/dashboard/showcase/s1/analytics?tab=${t}`

describe('attribution', () => {
  it('reads ad click ids: Google and Microsoft are paid search, Meta is paid social', () => {
    expect(classifyChannel(attribution({ click_id: 'gbraid' }))).toBe('paid_search')
    expect(attribution({ click_id: 'msclkid' })).toMatchObject({ source: 'bing', medium: 'cpc' })
    expect(classifyChannel(attribution({ click_id: 'msclkid' }))).toBe('paid_search')
    expect(classifyChannel(attribution({ click_id: 'fbclid', ref_host: 'l.instagram.com' }))).toBe('paid_social')
    expect(classifyChannel(attribution({ ref_host: 'l.instagram.com' }))).toBe('organic_social')
    expect(classifyChannel(attribution({ ref_host: 'site-x.jeffistores.in' }), ['site-x.jeffistores.in'])).toBe('direct')
  })
})

describe('showcaseAttention', () => {
  const base = { previous: ZERO, channels: [], previousChannels: [], unread: 0, tabHref }

  it('is quiet for a small site with nothing wrong', () => {
    expect(showcaseAttention({ ...base, current: { ...ZERO, sessions: 10, convertedSessions: 1, scrollSum: 600 } })).toEqual([])
  })

  it('flags waiting enquiries, visits without enquiries, a left form and a shallow page', () => {
    const current = { ...ZERO, sessions: 40, scrollSum: 40 * 30, formStarts: 8, formSubmits: 2 }
    const keys = showcaseAttention({ ...base, current, unread: 3 }).map(a => [a.key, a.href])
    expect(keys).toEqual([
      ['unread', tabHref('leads')],
      ['no-enquiries', tabHref('funnel')],
      ['form-abandoned', tabHref('funnel')],
      ['shallow', tabHref('behaviour')],
    ])
  })

  it('flags a falling contact rate and a channel that jumped without enquiries', () => {
    const row = (sessions: number, convertedSessions: number) => ({ channel: 'paid_social', label: 'Paid social', paid: true, sessions, newVisitors: 0, convertedSessions, leads: 0 })
    const out = showcaseAttention({
      ...base,
      current: { ...ZERO, sessions: 100, convertedSessions: 2, scrollSum: 6000 },
      previous: { ...ZERO, sessions: 100, convertedSessions: 10 },
      channels: [row(30, 0)],
      previousChannels: [row(10, 1)],
    })
    expect(out.map(a => a.key)).toEqual(['conversion-down', 'source-paid_social'])
    expect(out[0].title).toBe('Contact rate fell to 2.0% from 10.0%')
  })
})

describe('funnelBy', () => {
  it('sums rows per key, biggest first', () => {
    const rows = [
      { device: 'Mobile', sessions: 3, engaged: 2, contact: 1, form_started: 1, form_submitted: 1, lead: 1 },
      { device: 'Desktop', sessions: 1, engaged: 1, contact: 0, form_started: 0, form_submitted: 0, lead: 0 },
      { device: 'Mobile', sessions: 2, engaged: 1, contact: 0, form_started: 1, form_submitted: 0, lead: 0 },
    ]
    expect(funnelBy(rows, r => r.device)).toEqual([
      { key: 'Mobile', sessions: 5, engaged: 3, contact: 1, formStarted: 2, formSubmitted: 1, lead: 1 },
      { key: 'Desktop', sessions: 1, engaged: 1, contact: 0, formStarted: 0, formSubmitted: 0, lead: 0 },
    ])
  })
})

describe('leadsCsv', () => {
  it('writes IST times, the visit it came from, and neutralises formulas', () => {
    const lead: LeadRow = {
      id: 'l1',
      name: '=HYPERLINK("x")',
      phone: '+91 98765 43210',
      email: null,
      message: 'Hi, "urgent"\nplease call',
      createdAt: '2026-11-24T08:30:00.000Z',
      readAt: null,
      channel: 'Paid search',
      source: 'Google Ads / cpc',
      campaign: 'diwali',
      landing: '/',
      device: 'Mobile',
      country: 'IN',
    }
    const csv = leadsCsv([lead, { ...lead, id: 'l2', name: 'Asha', readAt: lead.createdAt, channel: null, source: null, campaign: null, landing: null, device: null, country: null }])
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toBe('Received (IST),Name,Phone,Email,Message,Status,Channel,Source,Campaign,Landing page,Device,Country')
    expect(lines[1].startsWith(`2026-11-24 14:00,"'=HYPERLINK(""x"")",'+91 98765 43210,,"Hi, ""urgent""\nplease call"`)).toBe(true)
    expect(csv).toContain('please call",New,Paid search,Google Ads / cpc,diwali,/,Mobile,IN\r\n')
    expect(csv).toContain(',Handled,Not linked to a visit,,,,,\r\n')
  })
})
