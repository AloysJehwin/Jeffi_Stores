import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/site/code/compile', () => ({ checkSection: vi.fn() }))
vi.mock('@/lib/site/code/literals', () => {
  class LiteralEditError extends Error {}
  return { LiteralEditError, codeLiterals: vi.fn(), editCodeLiterals: vi.fn() }
})

import { POST } from '@admin/app/api/(admin)/admin/site-builder/code/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { checkSection } from '@/lib/site/code/compile'
import { codeLiterals, editCodeLiterals, LiteralEditError } from '@/lib/site/code/literals'

const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })
const EDIT = { id: 'l1', from: 'Hi', to: 'Hello' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(codeLiterals).mockReturnValue([{ id: 'l1', text: 'Hi' }] as any)
})

describe('POST /api/admin/site-builder/code', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await POST(req({ source: 's', page: 'home' }))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
  })

  it.each([[undefined], [{ page: 'home' }], [{ source: 's', page: 'bogus' }], [{ source: 's', page: 'home', edits: [{ id: 'x'.repeat(13), from: 'a', to: 'b' }] }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
  })

  it('lists the editable literals when there are no edits', async () => {
    const res = await POST(req({ source: 'src', page: 'home' }))
    expect(await res.json()).toEqual({ literals: [{ id: 'l1', text: 'Hi' }] })
    expect(codeLiterals).toHaveBeenCalledWith('src')
    expect(editCodeLiterals).not.toHaveBeenCalled()
  })

  it('writes the edits in, checks the compile and returns the new source (nothing saved)', async () => {
    vi.mocked(editCodeLiterals).mockReturnValue('NEW SRC')
    vi.mocked(checkSection).mockReturnValue({ ok: true } as any)
    const res = await POST(req({ source: 'src', page: 'home', edits: [EDIT] }))
    expect(await res.json()).toEqual({ source: 'NEW SRC', literals: [{ id: 'l1', text: 'Hi' }] })
    expect(editCodeLiterals).toHaveBeenCalledWith('src', [EDIT])
    expect(checkSection).toHaveBeenCalledWith('NEW SRC', { page: 'home' })
  })

  it('returns 422 when an edit does not match', async () => {
    vi.mocked(editCodeLiterals).mockImplementation(() => {
      throw new LiteralEditError('Text changed since')
    })
    const res = await POST(req({ source: 'src', page: 'home', edits: [EDIT] }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Text changed since' })
  })

  it('returns 422 with the issues when the edited source no longer compiles', async () => {
    vi.mocked(editCodeLiterals).mockReturnValue('BROKEN')
    vi.mocked(checkSection).mockReturnValue({ ok: false, issues: [{ message: 'unexpected token' }] } as any)
    const res = await POST(req({ source: 'src', page: 'home', edits: [EDIT] }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('unexpected token')
    expect(body.issues).toEqual([{ message: 'unexpected token' }])
  })

  it('rethrows an unexpected edit failure', async () => {
    vi.mocked(editCodeLiterals).mockImplementation(() => {
      throw new Error('oops')
    })
    await expect(POST(req({ source: 'src', page: 'home', edits: [EDIT] }))).rejects.toThrow('oops')
  })
})
