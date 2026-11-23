import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/auth/admin-auth', () => ({ getAdminSession: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))

import { productsWriteError } from '@/lib/catalog/product-action-auth'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { hasScope } from '@/lib/auth/scopes'

const mockSession = vi.mocked(getAdminSession)
const mockHasScope = vi.mocked(hasScope)

describe('productsWriteError', () => {
  it('errors when there is no session', async () => {
    mockSession.mockResolvedValue(null as any)
    expect(await productsWriteError()).toMatch(/session has expired/i)
  })

  it('errors when the scope is missing', async () => {
    mockSession.mockResolvedValue({ role: 'staff', scopes: [] } as any)
    mockHasScope.mockReturnValue(false)
    expect(await productsWriteError()).toMatch(/do not have permission/i)
  })

  it('null when session has the products:write scope', async () => {
    mockSession.mockResolvedValue({ role: 'admin', scopes: ['products:write'] } as any)
    mockHasScope.mockReturnValue(true)
    expect(await productsWriteError()).toBeNull()
    expect(mockHasScope).toHaveBeenCalledWith('admin', ['products:write'], 'products:write')
  })
})
