'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { ensureFingerprintCookie } from '@/lib/client/fp-beacon'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string | null
  phone: string | null
  phoneVerified?: boolean
  dateOfBirth?: string | null
  createdAt: string
  avatarUrl: string | null
  isBusiness?: boolean
  approvalStatus?: string
  companyName?: string
  businessDiscountMap?: Record<string, number>
  policiesAcceptedVersion?: string | null
  requiresPolicyAcceptance?: boolean
  requiresDob?: boolean
  policyVersion?: string
}

export interface GoogleProfile {
  email: string
  firstName: string
  lastName: string
}

export type GoogleAuthResult = { newUser: true; profile: GoogleProfile } | { newUser: false; user: User }

interface GoogleSignupArgs {
  accessToken: string
  firstName: string
  lastName?: string
  phone: string
  dateOfBirth: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, otp: string, policiesAccepted?: boolean) => Promise<void>
  googleLogin: (idToken: string) => Promise<void>
  googleLoginWithAccessToken: (accessToken: string) => Promise<GoogleAuthResult>
  googleSignupComplete: (args: GoogleSignupArgs) => Promise<User>
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
  dateOfBirth?: string
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

  // Set the fp_hash device-binding cookie once on mount (SOFT/advisory session signal).
  useEffect(() => {
    ensureFingerprintCookie()
  }, [])

  const login = async (email: string, otp: string, policiesAccepted?: boolean) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, otp, policiesAccepted }),
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

  const googleLoginWithAccessToken = async (accessToken: string): Promise<GoogleAuthResult> => {
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
    if (data.newUser) {
      return { newUser: true, profile: data.profile as GoogleProfile }
    }
    setUser(data.user)
    return { newUser: false, user: data.user as User }
  }

  const googleSignupComplete = async (args: GoogleSignupArgs): Promise<User> => {
    const response = await fetch('/api/auth/google/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(args),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to create account')
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
      value={{
        user,
        isLoading,
        login,
        googleLogin,
        googleLoginWithAccessToken,
        googleSignupComplete,
        signup,
        logout,
        refreshUser,
      }}
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
