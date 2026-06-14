'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string | null
  phone: string | null
  createdAt: string
  avatarUrl: string | null
  isBusiness?: boolean
  approvalStatus?: string
  companyName?: string
  businessDiscountMap?: Record<string, number>
  policiesAcceptedVersion?: string | null
  requiresPolicyAcceptance?: boolean
  policyVersion?: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, otp: string) => Promise<void>
  googleLogin: (idToken: string) => Promise<void>
  googleLoginWithAccessToken: (accessToken: string) => Promise<User>
  signup: (data: SignupData) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

interface SignupData {
  email: string
  otp: string
  firstName: string
  lastName?: string
  phone?: string
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children, meEndpoint = '/api/auth/me' }: { children: ReactNode; meEndpoint?: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isBusiness = meEndpoint === '/api/business/me'
  const logoutEndpoint = isBusiness ? '/api/business/logout' : '/api/auth/logout'
  // On business.jeffistores.in the /business/* prefix is added by middleware rewrite,
  // so paths within the page must NOT include it — use /signin directly.
  const isBusinessSubdomain = typeof window !== 'undefined' && window.location.hostname.startsWith('business.')
  const logoutRedirect = isBusiness ? (isBusinessSubdomain ? '/signin' : '/business/signin') : '/'

  const fetchUser = async () => {
    try {
      const headers: HeadersInit = isBusiness ? { 'X-Auth-Portal': 'business' } : {}
      const response = await fetch(meEndpoint, { credentials: 'include', headers })
      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUser()
  }, [])

  const login = async (email: string, otp: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Login failed')
    }
    const data = await response.json()
    setUser(data.user)
  }

  const googleLogin = async (idToken: string) => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Google login failed')
    }
    const data = await response.json()
    setUser(data.user)
  }

  const googleLoginWithAccessToken = async (accessToken: string): Promise<User> => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Google login failed')
    }
    const data = await response.json()
    setUser(data.user)
    return data.user
  }

  const signup = async (signupData: SignupData) => {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupData),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Signup failed')
    }
    const data = await response.json()
    setUser(data.user)
  }

  const logout = async () => {
    try {
      await fetch(logoutEndpoint, { method: 'POST' })
    } finally {
      setUser(null)
      window.location.href = logoutRedirect
    }
  }

  const refreshUser = async () => {
    await fetchUser()
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, googleLogin, googleLoginWithAccessToken, signup, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
