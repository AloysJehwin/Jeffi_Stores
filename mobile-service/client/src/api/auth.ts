import { api } from './client'
import type { User } from '../types'

export async function sendOtp(email: string): Promise<void> {
  await api('/api/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
    token: null,
  })
}

export async function loginWithOtp(email: string, otp: string): Promise<{ token: string; user: User | null; isNewUser?: boolean }> {
  const data = await api<{ message?: string; user?: User; token?: string; isNewUser?: boolean; email?: string }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, otp }), token: null }
  )
  return {
    token: data.token || '',
    user: data.user || null,
    isNewUser: data.isNewUser,
  }
}

export async function signup(payload: {
  email: string
  firstName: string
  lastName: string
  phone?: string
}): Promise<{ token: string; user: User }> {
  return api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
    token: null,
  })
}

export async function getMe(): Promise<User> {
  const data = await api<{ user: User }>('/api/auth/me')
  return data.user
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
}

export async function googleAuth(idToken: string): Promise<{ token: string; user: User }> {
  return api('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
    token: null,
  })
}
