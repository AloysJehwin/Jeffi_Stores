import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireStaff = vi.hoisted(() => vi.fn())
const hasScope = vi.hoisted(() => vi.fn())
const notes = vi.hoisted(() => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  addAttachment: vi.fn(),
  getNote: vi.fn(),
  MAX_ATTACHMENTS: 3,
}))
const notifyOwnersOfNote = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/staff-auth', async () => {
  const { NextResponse } = await import('next/server')
  return { requireStaff, isStaffDenied: (x: unknown) => x instanceof NextResponse }
})
vi.mock('@/lib/auth/scopes', () => ({ hasScope }))
vi.mock('@/lib/shared/customer-notes', () => notes)
vi.mock('@/lib/shared/customer-notes-notify', () => ({ notifyOwnersOfNote }))

import { GET, POST } from '@storefront/app/api/(public)/staff/notes/route'

const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const ORDER = '22222222-2222-4222-8222-222222222222'
const get = (qs = '') => GET(new NextRequest(`http://localhost/api/staff/notes${qs}`))
const post = (fields: Record<string, string | File | string[]> | null) => {
  let body: FormData | string = 'plain'
  if (fields) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach(x => fd.append(k, x))
      else fd.append(k, v)
    }
    body = fd
  }
  return POST(new NextRequest('http://localhost/api/staff/notes', { method: 'POST', body, headers: fields ? {} : { 'content-type': 'text/plain' } }))
}

describe('GET /api/staff/notes', () => {
  beforeEach(() => {
    requireStaff.mockResolvedValue({ session: {} })
    notes.listNotes.mockResolvedValue([{ id: 'n1' }])
  })

  it('returns the guard denial as is', async () => {
    requireStaff.mockResolvedValue(NextResponse.json({ error: 'Sign in required' }, { status: 401 }))
    expect((await get(`?customerId=${CUSTOMER}`)).status).toBe(401)
  })

  it('400s without a valid customerId', async () => {
    expect((await get()).status).toBe(400)
    expect((await get('?customerId=x')).status).toBe(400)
  })

  it('lists the customer notes, optionally per order', async () => {
    expect(await (await get(`?customerId=${CUSTOMER}&orderId=${ORDER}`)).json()).toEqual({ notes: [{ id: 'n1' }] })
    expect(notes.listNotes).toHaveBeenCalledWith({ userId: CUSTOMER, orderId: ORDER, limit: 30 })
    await get(`?customerId=${CUSTOMER}`)
    expect(notes.listNotes).toHaveBeenLastCalledWith({ userId: CUSTOMER, orderId: null, limit: 30 })
  })
})

describe('POST /api/staff/notes', () => {
  beforeEach(() => {
    requireStaff.mockResolvedValue({ session: { adminId: 'a1', email: 's@x.test', name: 'Ravi', role: 'staff', scopes: [] } })
    hasScope.mockReturnValue(true)
    notes.createNote.mockResolvedValue({ id: 'n1' })
    notes.addAttachment.mockResolvedValue({ id: 'att1' })
    notes.getNote.mockResolvedValue({ id: 'n1', title: 'T' })
    notifyOwnersOfNote.mockResolvedValue(undefined)
  })

  it('returns the guard denial and 403s without the write scope', async () => {
    requireStaff.mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await post({ customerId: CUSTOMER, body: 'x' })).status).toBe(403)
    hasScope.mockReturnValue(false)
    expect((await post({ customerId: CUSTOMER, body: 'x' })).status).toBe(403)
    expect(notes.createNote).not.toHaveBeenCalled()
  })

  it('400s on a non-multipart body, a bad customerId, a bad order reference or an empty note', async () => {
    expect((await post(null)).status).toBe(400)
    expect((await post({ body: 'x' })).status).toBe(400)
    expect((await post({ customerId: CUSTOMER, body: 'x', orderId: 'nope' })).status).toBe(400)
    expect((await post({ customerId: CUSTOMER, body: 'x', returnRequestId: 'nope' })).status).toBe(400)
    const empty = await post({ customerId: CUSTOMER, title: ' ', body: ' ' })
    expect(empty.status).toBe(400)
    expect(notes.createNote).not.toHaveBeenCalled()
  })

  it('400s over the attachment limit', async () => {
    const files = Array.from({ length: 4 }, (_, i) => new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' }))
    const fd = new FormData()
    fd.append('customerId', CUSTOMER)
    files.forEach(f => fd.append('files', f))
    const res = await POST(new NextRequest('http://localhost/api/staff/notes', { method: 'POST', body: fd }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Maximum 3/)
  })

  it('creates the note with its attachments, notifies the owners and returns 201', async () => {
    const f1 = new File(['aaa'], 'a.jpg', { type: 'image/jpeg' })
    const f2 = new File(['bbb'], 'b.m4a', { type: 'audio/mp4' })
    const fd = new FormData()
    fd.append('customerId', CUSTOMER)
    fd.append('orderId', ORDER)
    fd.append('title', ' Visit ')
    fd.append('body', ' Asked for a refund ')
    fd.append('shared', 'true')
    fd.append('tags', JSON.stringify(['urgent']))
    fd.append('durations', JSON.stringify({ '1': 12 }))
    fd.append('files', f1)
    fd.append('files', f2)
    const res = await POST(new NextRequest('http://localhost/api/staff/notes', { method: 'POST', body: fd }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ note: { id: 'n1', title: 'T' }, warnings: [] })
    expect(notes.createNote).toHaveBeenCalledWith({
      userId: CUSTOMER,
      adminId: 'a1',
      body: 'Asked for a refund',
      title: 'Visit',
      tags: ['urgent'],
      orderId: ORDER,
      returnRequestId: null,
      sharedWithCustomer: true,
      source: 'staff_form',
    })
    expect(notes.addAttachment).toHaveBeenCalledTimes(2)
    expect(notes.addAttachment.mock.calls[1][2]).toEqual({ durationSeconds: 12, displayOrder: 1 })
    expect(notifyOwnersOfNote).toHaveBeenCalledWith({ id: 'n1', title: 'T' }, { email: 's@x.test', name: 'Ravi' })
  })

  it('collects attachment failures as warnings without failing the note', async () => {
    notes.addAttachment.mockResolvedValue({ error: 'Too large' })
    const fd = new FormData()
    fd.append('customerId', CUSTOMER)
    fd.append('body', 'hi')
    fd.append('files', new File(['x'], 'big.jpg', { type: 'image/jpeg' }))
    const res = await POST(new NextRequest('http://localhost/api/staff/notes', { method: 'POST', body: fd }))
    expect(res.status).toBe(201)
    expect((await res.json()).warnings).toEqual(['big.jpg: Too large'])
  })

  it('400s when note creation is refused and returns an empty 201 when nothing was stored', async () => {
    notes.createNote.mockResolvedValueOnce({ error: 'Customer not found' })
    const refused = await post({ customerId: CUSTOMER, body: 'x' })
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toBe('Customer not found')
    notes.createNote.mockResolvedValueOnce({ id: null })
    const none = await post({ customerId: CUSTOMER, body: 'x' })
    expect(none.status).toBe(201)
    expect(await none.json()).toEqual({ note: null, warnings: [] })
  })

  it('accepts repeated tag fields and tolerates malformed JSON fields', async () => {
    await post({ customerId: CUSTOMER, body: 'x', tags: ['a', 'b'], durations: '{bad' })
    expect(notes.createNote).toHaveBeenCalledWith(expect.objectContaining({ tags: ['a', 'b'] }))
  })
})
