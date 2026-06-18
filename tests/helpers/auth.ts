import { vi } from 'vitest'

export const mockAdminPayload = {
  adminId: 'admin-uuid-123',
  username: 'testadmin',
  role: 'super_admin',
  scopes: [],
}

export const mockUserPayload = {
  userId: 'user-uuid-456',
  email: 'test@example.com',
  type: 'customer',
}

export const mockBusinessPayload = {
  userId: 'biz-uuid-789',
  email: 'biz@example.com',
  type: 'business',
  isBusiness: true,
  approvalStatus: 'approved',
}

export function mockAuthenticateUser(payload: any | null = mockUserPayload) {
  vi.mock('@/lib/jwt', () => ({
    authenticateAnyUser: vi.fn().mockResolvedValue(payload),
    verifyToken: vi.fn().mockResolvedValue(payload),
    signToken: vi.fn().mockResolvedValue('mock-token'),
  }))
}

export function mockCookies(values: Record<string, string> = {}) {
  vi.mock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({
      get: (key: string) => values[key] ? { value: values[key] } : undefined,
      set: vi.fn(),
      delete: vi.fn(),
    }),
    headers: vi.fn().mockResolvedValue(new Headers()),
  }))
}
