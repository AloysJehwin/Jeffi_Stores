import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireStaff = vi.hoisted(() => vi.fn())
const hasScope = vi.hoisted(() => vi.fn())
const getNote = vi.hoisted(() => vi.fn())
const deleteNote = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/staff-auth', async () => {
  const { NextResponse } = await import('next/server')
  return { requireStaff, isStaffDenied: (x: unknown) => x instanceof NextResponse }
})
vi.mock('@/lib/auth/scopes', () => ({ hasScope }))
vi.mock('@/lib/shared/customer-notes', () => ({ getNote, deleteNote }))

import { DELETE } from '@storefront/app/api/(public)/staff/notes/[id]/route'

const del = () =>
  DELETE(new NextRequest('http://localhost/api/staff/notes/n1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'n1' }) })

describe('DELETE /api/staff/notes/[id]', () => {
  beforeEach(() => {
    requireStaff.mockResolvedValue({ session: { adminId: 'a1', role: 'staff', scopes: [] } })
    hasScope.mockReturnValue(true)
    getNote.mockResolvedValue({ id: 'n1', adminId: 'a1', userId: 'c1' })
    deleteNote.mockResolvedValue(undefined)
  })

  it('returns the guard denial as is', async () => {
    requireStaff.mockResolvedValue(NextResponse.json({ error: 'Sign in required' }, { status: 401 }))
    expect((await del()).status).toBe(401)
    expect(requireStaff).toHaveBeenCalledWith(expect.anything(), 'customers:write')
    expect(deleteNote).not.toHaveBeenCalled()
  })

  it('403s when the session lacks the write scope', async () => {
    hasScope.mockReturnValue(false)
    expect((await del()).status).toBe(403)
    expect(getNote).not.toHaveBeenCalled()
  })

  it('404s for an unknown note', async () => {
    getNote.mockResolvedValue(null)
    expect((await del()).status).toBe(404)
  })

  it('403s when deleting another staff member note, leaving it in place', async () => {
    getNote.mockResolvedValue({ id: 'n1', adminId: 'someone-else', userId: 'c1' })
    const res = await del()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/own notes/)
    expect(deleteNote).not.toHaveBeenCalled()
  })

  it('deletes the staff member own note', async () => {
    expect(await (await del()).json()).toEqual({ success: true })
    expect(deleteNote).toHaveBeenCalledWith('n1', 'c1')
  })
})
