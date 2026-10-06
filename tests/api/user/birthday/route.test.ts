import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ verifyBirthdayToken: vi.fn() }))

import { GET, POST } from '@/app/api/(public)/user/birthday/route'
import { queryOne } from '@/lib/shared/db'
import { verifyBirthdayToken } from '@/lib/auth/jwt'

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>
const mockVerify = verifyBirthdayToken as ReturnType<typeof vi.fn>

const URL = 'http://localhost/api/user/birthday'
const post = (body: unknown) =>
  new NextRequest(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('/api/user/birthday', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerify.mockResolvedValue({ userId: 'u1' })
    mockQueryOne.mockResolvedValue({ id: 'u1', first_name: 'Sam', date_of_birth: null })
  })

  describe('GET', () => {
    it('rejects a missing or invalid token', async () => {
      expect((await GET(new NextRequest(URL))).status).toBe(400)
      mockVerify.mockResolvedValue(null)
      expect((await GET(new NextRequest(`${URL}?token=bad`))).status).toBe(401)
    })

    it('greets the customer and says whether a birthday is already saved', async () => {
      const body = await (await GET(new NextRequest(`${URL}?token=t`))).json()
      expect(body).toEqual({ firstName: 'Sam', alreadySet: false })
    })

    it('answers 404 for an account that is not an active customer', async () => {
      mockQueryOne.mockResolvedValue(null)
      expect((await GET(new NextRequest(`${URL}?token=t`))).status).toBe(404)
    })
  })

  describe('POST', () => {
    it('rejects an invalid date before writing', async () => {
      const res = await POST(post({ token: 't', dateOfBirth: '2999-01-01' }))
      expect(res.status).toBe(400)
      expect(mockQueryOne).toHaveBeenCalledTimes(1)
    })

    it('saves the birthday only when none is on file', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u1', first_name: 'Sam', date_of_birth: null })
      mockQueryOne.mockResolvedValueOnce({ id: 'u1' })
      const body = await (await POST(post({ token: 't', dateOfBirth: '1990-05-17' }))).json()
      expect(body).toEqual({ ok: true })
      const [sql, args] = mockQueryOne.mock.calls[1]
      expect(String(sql)).toContain('date_of_birth IS NULL')
      expect(args).toEqual(['u1', '1990-05-17'])
    })

    it('never overwrites a birthday that is already saved', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u1', first_name: 'Sam', date_of_birth: '1990-05-17' })
      mockQueryOne.mockResolvedValueOnce(null)
      const body = await (await POST(post({ token: 't', dateOfBirth: '1985-01-01' }))).json()
      expect(body).toEqual({ ok: true, alreadySet: true })
    })

    it('rejects an expired token', async () => {
      mockVerify.mockResolvedValue(null)
      expect((await POST(post({ token: 'old', dateOfBirth: '1990-05-17' }))).status).toBe(401)
    })
  })
})
